import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import {
	INGESTION_FAILURE_STATUSES,
	INGESTION_SUCCESS_STATUSES,
	chunk,
	databoxApiRequest,
	databoxApiRequestAllItems,
	unwrap,
} from './GenericFunctions';

/**
 * Programmatic style (not declarative): "Push Records" makes several dependent calls per run
 * (split into batches -> push each batch -> poll the ingestion until Databox confirms it -> next batch),
 * which declarative routing cannot express.
 */

const datasetLocator = {
	displayName: 'Dataset',
	name: 'datasetId',
	type: 'resourceLocator' as const,
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The Databox dataset',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list' as const,
			typeOptions: { searchListMethod: 'searchDatasets', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string' as const,
			placeholder: 'e.g. 1234567',
		},
	],
};

export class Databox implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Databox',
		name: 'databox',
		icon: { light: 'file:databox.svg', dark: 'file:databox.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Push data into Databox datasets and manage datasets',
		defaults: { name: 'Databox' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'databoxApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Dataset', value: 'dataset' },
					{ name: 'Ingestion', value: 'ingestion' },
				],
				default: 'dataset',
			},

			// ---------------- Dataset operations ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['dataset'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a dataset in a data source',
						action: 'Create a dataset',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a dataset',
						action: 'Get a dataset',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many datasets',
						action: 'Get many datasets',
					},
					{
						name: 'Push Records',
						value: 'pushRecords',
						description:
							'Send records to a dataset in batches, confirming each batch before sending the next',
						action: 'Push records to a dataset',
					},
				],
				default: 'pushRecords',
			},

			// Push Records
			{
				...datasetLocator,
				displayOptions: { show: { resource: ['dataset'], operation: ['pushRecords', 'get'] } },
			},
			{
				displayName: 'Records Source',
				name: 'recordsSource',
				type: 'options',
				displayOptions: { show: { resource: ['dataset'], operation: ['pushRecords'] } },
				options: [
					{
						name: 'Each Input Item Is a Record',
						value: 'items',
						description:
							'All input items are sent together to one dataset, as one record each. Dataset and options are read from the first item.',
					},
					{
						name: 'Array Field on Each Item',
						value: 'field',
						description: 'Each input item holds an array of records in a field and is pushed separately',
					},
				],
				default: 'items',
			},
			{
				displayName: 'Records Field',
				name: 'recordsField',
				type: 'string',
				required: true,
				default: 'records',
				displayOptions: {
					show: { resource: ['dataset'], operation: ['pushRecords'], recordsSource: ['field'] },
				},
				description: 'Name of the field on each input item that contains the array of records',
			},
			{
				displayName: 'Options',
				name: 'pushOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['dataset'], operation: ['pushRecords'] } },
				options: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 10000 },
						default: 500,
						description: 'Maximum number of records sent in one request',
					},
					{
						displayName: 'Max Wait per Batch (Seconds)',
						name: 'maxWaitSeconds',
						type: 'number',
						typeOptions: { minValue: 10, maxValue: 3600 },
						default: 600,
						description:
							'How long to keep checking a batch (after 3s, 10s, then every 60s) before giving up',
					},
					{
						displayName: 'On Rejected Records',
						name: 'onRejected',
						type: 'options',
						options: [
							{
								name: 'Stop With Error',
								value: 'error',
								description: 'Fail the node if Databox rejects any record; remaining batches are not sent',
							},
							{
								name: 'Continue',
								value: 'continue',
								description: 'Show the rejected count on the output and send the next batch',
							},
						],
						default: 'error',
						description:
							'What to do when Databox confirms a batch but rejected some of its records (only applies when waiting for confirmation)',
					},
					{
						displayName: 'On Timeout',
						name: 'onTimeout',
						type: 'options',
						options: [
							{
								name: 'Stop With Error',
								value: 'error',
								description: 'Fail the node; remaining batches are not sent',
							},
							{
								name: 'Continue',
								value: 'continue',
								description: 'Record the batch as unconfirmed and send the next one',
							},
						],
						default: 'error',
						description: 'What to do when a batch is still processing after the max wait',
					},
					{
						displayName: 'Use Idempotency Keys',
						name: 'useIdempotencyKeys',
						type: 'boolean',
						default: false,
						description:
							'Whether to send an Idempotency-Key per batch (execution + dataset + batch number), so a retried request is not ingested twice',
					},
					{
						displayName: 'Wait for Confirmation',
						name: 'waitForCompletion',
						type: 'boolean',
						default: true,
						description:
							'Whether to check each batch\'s ingestion status and only send the next batch once Databox confirms the current one',
					},
				],
			},

			// Create dataset
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['dataset'], operation: ['create'] } },
				description: 'Display name of the dataset',
			},
			{
				displayName: 'Data Source ID',
				name: 'dataSourceId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['dataset'], operation: ['create'] } },
				description: 'ID of the Databox data source to create the dataset in',
			},
			{
				displayName: 'Columns',
				name: 'schema',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				required: true,
				placeholder: 'Add Column',
				default: {},
				displayOptions: { show: { resource: ['dataset'], operation: ['create'] } },
				options: [
					{
						displayName: 'Column',
						name: 'column',
						values: [
							{
								displayName: 'Column ID',
								name: 'id',
								type: 'string',
								default: '',
								description: 'Column identifier, matching the keys in the records you push',
							},
							{
								displayName: 'Data Type',
								name: 'dataType',
								type: 'options',
								options: [
									{ name: 'Date/Time', value: 'datetime' },
									{ name: 'Number', value: 'number' },
									{ name: 'String', value: 'string' },
								],
								default: 'string',
							},
						],
					},
				],
			},
			{
				displayName: 'Primary Key Columns',
				name: 'primaryKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. order_number',
				displayOptions: { show: { resource: ['dataset'], operation: ['create'] } },
				description:
					'Comma-separated column IDs that uniquely identify a record. Records with an existing key are updated in place instead of appended.',
			},

			// Get many datasets
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['dataset', 'ingestion'], operation: ['getAll'] } },
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: {
					show: { resource: ['dataset', 'ingestion'], operation: ['getAll'], returnAll: [false] },
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['dataset'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Data Source ID',
						name: 'dataSourceId',
						type: 'number',
						default: 0,
						description: 'Only return datasets in this data source',
					},
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Only return datasets whose name matches this text',
					},
				],
			},

			// ---------------- Ingestion operations ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['ingestion'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the status of an ingestion',
						action: 'Get an ingestion',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many ingestions of a dataset',
						action: 'Get many ingestions',
					},
				],
				default: 'get',
			},
			{
				...datasetLocator,
				displayOptions: { show: { resource: ['ingestion'] } },
			},
			{
				displayName: 'Ingestion ID',
				name: 'ingestionId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['ingestion'], operation: ['get'] } },
				description: 'The ingestion ID returned when the records were pushed',
			},
		],
	};

	methods = {
		listSearch: {
			async searchDatasets(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = {};
				if (filter) qs.search = filter;
				const datasets = await databoxApiRequestAllItems.call(this, '/v2/datasets', qs, 200);
				return {
					results: datasets.map((d) => ({
						name: String(d.name ?? d.id),
						value: String(d.id),
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// "Each input item is a record": one push for all input items, driven by item 0's parameters.
		if (resource === 'dataset' && operation === 'pushRecords') {
			const source = this.getNodeParameter('recordsSource', 0) as string;
			if (source === 'items') {
				try {
					const records = items.map((item) => item.json);
					const out = await pushRecords.call(this, 0, records);
					returnData.push(...out.map((json) => ({ json, pairedItem: items.map((_, i) => ({ item: i })) })));
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: 0 } });
					} else {
						// NodeOperationError passes through unchanged; API errors keep their messages.
						throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: 0 });
					}
				}
				return [returnData];
			}
		}

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'dataset') {
					if (operation === 'pushRecords') {
						const field = this.getNodeParameter('recordsField', i) as string;
						const records = items[i].json[field];
						if (!Array.isArray(records)) {
							throw new NodeOperationError(
								this.getNode(),
								`Field "${field}" on item ${i} is not an array of records`,
								{ itemIndex: i },
							);
						}
						const out = await pushRecords.call(this, i, records as IDataObject[]);
						returnData.push(...out.map((json) => ({ json, pairedItem: { item: i } })));
					} else if (operation === 'create') {
						const columns =
							((this.getNodeParameter('schema', i) as IDataObject).column as IDataObject[]) ?? [];
						if (!columns.length) {
							throw new NodeOperationError(this.getNode(), 'Add at least one column', {
								itemIndex: i,
							});
						}
						const primaryKey = (this.getNodeParameter('primaryKey', i) as string)
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean);
						const body: IDataObject = {
							name: this.getNodeParameter('name', i) as string,
							dataSourceId: this.getNodeParameter('dataSourceId', i) as number,
							schema: columns.map((c) => ({ id: c.id, dataType: c.dataType })),
						};
						if (primaryKey.length) body.primaryKey = primaryKey;
						const response = await databoxApiRequest.call(this, 'POST', '/v2/datasets', body);
						returnData.push({ json: unwrap(response), pairedItem: { item: i } });
					} else if (operation === 'get') {
						const id = getDatasetId.call(this, i);
						const response = await databoxApiRequest.call(this, 'GET', `/v2/datasets/${id}`);
						returnData.push({ json: unwrap(response), pairedItem: { item: i } });
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.dataSourceId) qs.dataSourceId = filters.dataSourceId;
						if (filters.search) qs.search = filters.search;
						const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
						const datasets = await databoxApiRequestAllItems.call(this, '/v2/datasets', qs, limit);
						returnData.push(...datasets.map((json) => ({ json, pairedItem: { item: i } })));
					}
				} else if (resource === 'ingestion') {
					const id = getDatasetId.call(this, i);
					if (operation === 'get') {
						const ingestionId = encodeURIComponent(this.getNodeParameter('ingestionId', i) as string);
						const response = await databoxApiRequest.call(
							this,
							'GET',
							`/v2/datasets/${id}/ingestions/${ingestionId}`,
						);
						returnData.push({ json: unwrap(response), pairedItem: { item: i } });
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
						const ingestions = await databoxApiRequestAllItems.call(
							this,
							`/v2/datasets/${id}/ingestions`,
							{},
							limit,
						);
						returnData.push(...ingestions.map((json) => ({ json, pairedItem: { item: i } })));
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

function getDatasetId(this: IExecuteFunctions, itemIndex: number): string {
	const id = this.getNodeParameter('datasetId', itemIndex, '', { extractValue: true }) as string;
	if (!String(id).trim()) {
		throw new NodeOperationError(this.getNode(), 'Dataset is required', { itemIndex });
	}
	return encodeURIComponent(String(id).trim());
}

/**
 * Push records serially in batches. For each batch: POST the records, then (if waiting) poll the
 * ingestion at 3s, 10s, then every 60s until Databox reports success, a failure, or the max wait passes.
 * Never purges the dataset: use a primary key on the dataset so re-sent records update in place.
 */
async function pushRecords(
	this: IExecuteFunctions,
	itemIndex: number,
	records: IDataObject[],
): Promise<IDataObject[]> {
	const datasetId = getDatasetId.call(this, itemIndex);
	const options = this.getNodeParameter('pushOptions', itemIndex, {}) as IDataObject;
	const batchSize = (options.batchSize as number) ?? 500;
	const waitForCompletion = options.waitForCompletion !== false;
	const maxWaitMs = ((options.maxWaitSeconds as number) ?? 600) * 1000;
	const onTimeout = (options.onTimeout as string) ?? 'error';
	const useIdempotencyKeys = options.useIdempotencyKeys === true;
	const onRejected = (options.onRejected as string) ?? 'error';

	if (!records.length) {
		return [{ datasetId: decodeURIComponent(datasetId), batches: 0, recordsSent: 0, status: 'nothing_to_send' }];
	}

	const results: IDataObject[] = [];
	const batches = chunk(records, batchSize);

	for (let b = 0; b < batches.length; b++) {
		const headers: IDataObject = {};
		if (useIdempotencyKeys) {
			headers['Idempotency-Key'] = `${this.getExecutionId()}-${datasetId}-${itemIndex}-${b}`;
		}
		const pushResponse = await databoxApiRequest.call(
			this,
			'POST',
			`/v2/datasets/${datasetId}/data`,
			{ records: batches[b] },
			undefined,
			headers,
		);
		const pushed = unwrap(pushResponse);
		const ingestionId = String(pushed.ingestionId ?? pushed.id ?? '');
		const result: IDataObject = {
			datasetId: decodeURIComponent(datasetId),
			batch: b + 1,
			batches: batches.length,
			recordsSent: batches[b].length,
			ingestionId,
			status: String(pushed.status ?? 'submitted'),
		};

		if (waitForCompletion) {
			if (!ingestionId) {
				throw new NodeOperationError(
					this.getNode(),
					`Databox did not return an ingestion ID for batch ${b + 1}, so it cannot be confirmed`,
					{ itemIndex },
				);
			}
			const started = Date.now();
			const waits = [3000, 10000];
			let attempt = 0;
			let finalStatus = 'processing';
			let ingestion: IDataObject = {};
			while (true) {
				const wait = waits[attempt] ?? 60000;
				if (Date.now() - started + wait > maxWaitMs && attempt > 0) break;
				await sleep(wait);
				attempt++;
				const detail = await databoxApiRequest.call(
					this,
					'GET',
					`/v2/datasets/${datasetId}/ingestions/${encodeURIComponent(ingestionId)}`,
				);
				ingestion = unwrap(detail);
				const status = String(ingestion.status ?? '').toLowerCase();
				if (INGESTION_SUCCESS_STATUSES.includes(status)) {
					finalStatus = 'success';
					break;
				}
				if (INGESTION_FAILURE_STATUSES.includes(status)) {
					throw new NodeOperationError(
						this.getNode(),
						`Databox ingestion ${ingestionId} for batch ${b + 1} of ${batches.length} ended with status "${status}". Remaining batches were not sent.`,
						{ itemIndex, description: JSON.stringify(ingestion.errors ?? ingestion) },
					);
				}
			}
			if (finalStatus !== 'success') {
				if (onTimeout === 'error') {
					throw new NodeOperationError(
						this.getNode(),
						`Databox ingestion ${ingestionId} for batch ${b + 1} of ${batches.length} was still processing after ${Math.round(maxWaitMs / 1000)}s. Remaining batches were not sent. If this keeps happening, the dataset's ingestion may be stuck.`,
						{ itemIndex },
					);
				}
				finalStatus = 'unconfirmed';
			}
			result.status = finalStatus;
			result.ingestion = ingestion;

			if (finalStatus === 'success') {
				const counts =
					((ingestion.summary as IDataObject | undefined)?.ingestion as IDataObject | undefined) ?? {};
				const rejected = Number(counts.rejectedRecordCount ?? 0) || 0;
				result.recordsAppended = Number(counts.appendedRecordCount ?? 0) || 0;
				result.recordsOverwritten = Number(counts.overwrittenRecordCount ?? 0) || 0;
				result.recordsRejected = rejected;
				if (rejected > 0) {
					if (onRejected === 'error') {
						throw new NodeOperationError(
							this.getNode(),
							`Databox rejected ${rejected} of ${batches[b].length} records in batch ${b + 1} of ${batches.length} (ingestion ${ingestionId}). Remaining batches were not sent.`,
							{
								itemIndex,
								description: `Rejection details: ${JSON.stringify(ingestion.errors ?? 'none returned')}. Usually a value that does not match the column's data type, or a missing column. Set Options > On Rejected Records to Continue to send the rest anyway.`,
							},
						);
					}
					result.status = 'success_with_rejections';
				}
			}
		}
		results.push(result);
	}
	return results;
}
