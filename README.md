# API Testing with Postman: The Complete Course — Practice Files

The companion files for the QAMadeEasy course **API Testing with Postman: The Complete Course**.
Everything the book asks you to send, test or run is here, and every request and test in it was run before release.

| Folder | What is inside | Book |
|---|---|---|
| `practice-api/` | The practice API the whole course uses. Nothing to install: just Node.js. | Every chapter |
| `collections/` | One Postman collection per chapter, the `chNN-hands-on` collections with every request you send in Chapters 1-7 (and the hands-on steps of Chapters 12, 19, 21-25 and Appendices A-B), and the environment `local.postman_environment.json` | Chapters 0-33 |
| `data/` | CSV and JSON data files for data-driven tests, and a small file to upload | Chapters 9, 11, 20, 27, 33 |
| `tools/` | Helper scripts for coverage and performance | Chapters 30, 31 |
| `ci/` | A GitHub Actions workflow and a Jenkinsfile that run the tests with Newman | Chapter 28 |
| `code-tests/` | The same login-and-order test written with Playwright (TypeScript) | Chapter 32 |

## What you need

- **Node.js 18 or newer** (the LTS version from https://nodejs.org)
- **Postman desktop app** (https://www.postman.com/downloads)
- For Chapters 27-28 only: Newman, installed with `npm install -g newman newman-reporter-htmlextra`

## 1. Start the practice API

Open a terminal in the `practice-api` folder and run:

```
node server.js
```

You should see:

```
QAMadeEasy Practice API is running at http://localhost:3000
```

Open http://localhost:3000/docs in your browser to see every endpoint. Leave the terminal open while you work;
press `Ctrl+C` to stop the API. Restarting it (or sending `POST http://localhost:3000/api/reset`) puts all the data
back to the starting state.

Logins: `tester` / `Test@123` (user), `admin` / `Admin@123` (admin), `buyer2` / `Buyer@123` (user).
API key: `qa-key-123`.

## 2. Import the collections into Postman

Drag the whole `collections` folder onto the Postman window (or click **Use resources or import** in your
workspace and choose the **Import** tab; older versions have an **Import** button at the top of the sidebar).
Then select the environment **Practice API - Local** in the environment selector at the top right.

Run `ch00-setup-check` first: if all its tests pass, your setup is ready.

## 3. Run collections from the command line (Chapter 27)

From this folder:

```
newman run collections/ch33-capstone.postman_collection.json -e collections/local.postman_environment.json
```

## Results that are expected

A few collections fail **on purpose**, because the book uses them to show what a failure looks like:
`ch11-variables` (one request), `ch13-javascript` (folder 10), `ch18-test-mistakes`, `ch21-drift-check`,
`ch23-insecure-findings` (the findings folder), `ch29-team-workflow` (the Vault demo folder in Newman) and
`ch30-flaky-demo`. The chapter explains each one.
`ch20-data-driven` needs its data file (`data/ch20-users.csv` or `.json`), as Chapter 20 shows.

Some collections change data. If a run behaves differently the second time, restart the practice API or send
`POST /api/reset`, then run again.

The `/api/insecure/...` endpoints are deliberately vulnerable, for the security chapter only. Test only systems
you own or have written permission to test.

## If something goes wrong

| You see | Do this |
|---|---|
| `'node' is not recognized` / `command not found` | Install Node.js 18 or newer, then open a new terminal. |
| `Port 3000 is already in use` | The API is already running in another window, or another program uses port 3000. Close it, or start the API on another port (the message shows how) and change `baseUrl` in the environment. |
| `ECONNREFUSED` in Postman | The practice API is not running. Start it with `node server.js`. |
| `{{baseUrl}}` shows in red, or requests go to a strange address | Select the **Practice API - Local** environment at the top right. |
| `newman: command not found` | Run `npm install -g newman newman-reporter-htmlextra`, then open a new terminal. |
| `npm install` fails at work | A company proxy may block the npm registry. Try on a home network, or ask IT for the npm proxy settings. |

© 2026 QAMadeEasy. For personal practice with the book.
