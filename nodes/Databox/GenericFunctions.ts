import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const DATABOX_BASE_URL = 'https://api.databox.com';

/** Ingestion statuses treated as finished OK / finished failed. Anything else = still processing. */
export const INGESTION_SUCCESS_STATUSES = ['success', 'succeeded', 'completed', 'complete', 'done'];
export const INGESTION_FAILURE_STATUSES = ['failed', 'failure', 'error', 'rejected', 'cancelled', 'canceled'];

export async function databoxApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	headers?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${DATABOX_BASE_URL}${endpoint}`,
		json: true,
		headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
	};
	if (body && Object.keys(body).length) options.body = body;
	if (qs && Object.keys(qs).length) options.qs = qs;

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'databoxApi',
			options,
		)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** v2 responses nest the payload under `data`. */
export function unwrap(response: IDataObject): IDataObject {
	return (response?.data as IDataObject) ?? response;
}

/** Fetch every page of a v2 list endpoint (zero-indexed `page`, max `pageSize` 100). */
export async function databoxApiRequestAllItems(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	endpoint: string,
	qs: IDataObject = {},
	limit?: number,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let page = 0;
	const pageSize = 100;
	// Guard against an API that never reports a total.
	for (let guard = 0; guard < 1000; guard++) {
		const response = await databoxApiRequest.call(this, 'GET', endpoint, undefined, {
			...qs,
			page,
			pageSize,
		});
		const data = unwrap(response);
		const items = (data.items as IDataObject[]) ?? [];
		results.push(...items);
		if (limit !== undefined && results.length >= limit) return results.slice(0, limit);
		const totalItems = (data.pagination as IDataObject | undefined)?.totalItems as number | undefined;
		if (!items.length || items.length < pageSize) break;
		if (totalItems !== undefined && results.length >= totalItems) break;
		page++;
	}
	return results;
}

export function chunk<T>(array: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
	return out;
}
