const owner = 'your_owner';
const repo = 'your_repo';
const accessToken = 'your_access_token';

const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;

try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pull requests: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(data);
} catch (error) {
	console.error(error);
}