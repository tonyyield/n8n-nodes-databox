import type {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class DataboxApi implements ICredentialType {
	name = 'databoxApi';

	displayName = 'Databox API';

	icon: Icon = { light: 'file:../nodes/Databox/databox.svg', dark: 'file:../nodes/Databox/databox.dark.svg' };

	documentationUrl = 'https://developers.databox.com/docs/api/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in Databox under Account Management > Profile > Password & Security > API key. Only Admin users can create keys.',
		},
		{
			displayName: 'Account ID',
			name: 'accountId',
			type: 'string',
			default: '',
			description:
				'Optional. Only for organizations with accounts enabled: the ID of the account to act on (sent as the x-account-id header). Leave empty to act on the main organization.',
		},
	];

	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		const headers: Record<string, string> = {
			...((requestOptions.headers as Record<string, string>) ?? {}),
			'x-api-key': credentials.apiKey as string,
		};
		const accountId = String(credentials.accountId ?? '').trim();
		if (accountId) headers['x-account-id'] = accountId;
		return { ...requestOptions, headers };
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.databox.com',
			url: '/v2/auth/validate-key',
			method: 'GET',
		},
	};
}
