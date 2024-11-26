# Token Authentication and Setup

## Overview

This document explains how to set up and use token-based authentication for the BossyPaints application. Token authentication is used to securely access the BossDB API and other protected resources.

## Steps to Set Up Token Authentication

### 1. Obtain an API Token

To use the BossDB API, you need to obtain an API token. You can generate or find your API token on the [BossDB API Management page](https://api.bossdb.io/v1/mgmt/token).

### 2. Store the API Token

Once you have your API token, you need to store it in the application. The token will be used to authenticate API requests.

1. Open the application.
2. Navigate to the settings section.
3. Enter your API token in the provided input field.
4. Click the "Save" button to store the token in local storage.

### 3. Using the API Token

The stored API token will be automatically included in the headers of API requests to the BossDB. This ensures that all requests are authenticated.

### 4. Fetching the Username

The application includes a feature to fetch the username associated with the API token. This is done by calling the `/api/bossdb/username` endpoint on the server, which in turn calls the BossDB API.

### Example Code

#### Storing the Token

```svelte
<script lang="ts">
	import API from '$lib/api';

	let apiToken: string | null = '';

	// Optionally get the API token from local storage
	if (localStorage.getItem('apiToken')) {
		apiToken = localStorage.getItem('apiToken');
	}

	function saveToken() {
		if (apiToken) {
			localStorage.setItem('apiToken', apiToken);
			API.getBossDBUsernameFromToken(apiToken).then((response) => {
				console.log(response.username);
			});
		}
	}
</script>

<input type="text" bind:value={apiToken} placeholder="API Token" />
<button on:click={saveToken}>Save</button>
```
