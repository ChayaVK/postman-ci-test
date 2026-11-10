# REST API Testing with Postman: The Essentials (practice files)

| Folder | What is inside |
|---|---|
| `practice-api/` | The practice API. Nothing to install: just Node.js 18 or newer. |
| `collections/` | The collection `rest-essentials.postman_collection.json` (every request and test in the guide) and the environment `local.postman_environment.json` |
| `data/` | `users.csv`, the data file for folder 06 (Chapter 9) |
| `ci/` | `api-tests.yml`, a GitHub Actions workflow that runs the tests with Newman (Chapter 12) |

## Start

1. Install Node.js (LTS) from nodejs.org.
2. Open a terminal in `practice-api` and run `node server.js`. Keep the window open.
3. In Postman: **Import** the whole `collections` folder, then select the environment **Practice API - Local** at the top right.
4. Open folder **01 Getting started**, select **Health check**, click **Send**.

Logins: `tester` / `Test@123`, `admin` / `Admin@123`. All endpoints: http://localhost:3000/docs

## Run everything with Newman (Chapter 12)

```
npm install -g newman newman-reporter-htmlextra
newman run collections/rest-essentials.postman_collection.json -e collections/local.postman_environment.json
newman run collections/rest-essentials.postman_collection.json -e collections/local.postman_environment.json --folder "06 Data-driven: create users" -d data/users.csv
```

Run these from this folder (the one that holds `collections` and `data`), with the practice API running.

## If something goes wrong

| You see | Do this |
|---|---|
| `'node' is not recognized` / `command not found` | Install Node.js, then open a new terminal. |
| `Port 3000 is already in use` | The API already runs in another window. Close it, or start on another port (Command Prompt: `set PORT=4000 && node server.js`) and change `baseUrl` in the environment. |
| `ECONNREFUSED` in Postman | The practice API is not running. Start it with `node server.js`. |
| `{{baseUrl}}` shows in red / `ENOTFOUND {{baseurl}}` | Select the environment **Practice API - Local** at the top right. |
| `newman: command not found` | Run `npm install -g newman newman-reporter-htmlextra`, then open a new terminal. |
