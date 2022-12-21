# ChatGPT Slack Bot

This Slack Bot is implemented in Node.js, underlying uses the library https://github.com/transitive-bullshit/chatgpt-api, which leverages puppeteer headless browser in order to perform logging in ChatGPT and asks questions.

### Setup

##### Build and run with Docker
```
docker build -t chatgpt_slackbot .
docker run chatgpt_slackbot
```

### Environment Variables
|Key|required|description|
|--|--|--|
|SLACK_BOT_TOKEN|Y|Your Slack Bot token. See https://api.slack.com/|
|SLACK_APP_TOKEN|Y|Your Slack App token. See https://api.slack.com/|
|SLACK_BOT_USER_ID|Y|The User ID of your Slack Bot. See https://api.slack.com/|
|CHATGPT_EMAIL|Y|The email of your chatgpt account|
|CHATGPT_PASSWORD|Y|The password of your chatgpt account|
|PROXY_SERVER|N|e.g.: 12.123.234.345:23456, leave it blank if not used|
|IS_GOOGLE_LOGIN|N|1 or 0, default 0|
