import ChatGptConnector from './chatgpt-connector.js';
import ChatGtpSlackBot from './slackbot.js';

import dotenv from 'dotenv';

dotenv.config();

async function main() {

    if (!process.env.CHATGPT_EMAIL || !process.env.CHATGPT_PASSWORD) {
        throw new Error('Missing email / password');
    };

    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
        throw new Error('Missing slack token');
    };

    const chatGptConnector = new ChatGptConnector({
        accEmail: process.env.CHATGPT_EMAIL,
        accPassword: process.env.CHATGPT_PASSWORD,
        isGoogleLogin: Boolean(Number(process.env.IS_GOOGLE_LOGIN)),
        proxyServer: process.env.PROXY_SERVER,
    });

    const slackBot = new ChatGtpSlackBot({
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        slackAppToken: process.env.SLACK_APP_TOKEN,
        chatGptConnector: chatGptConnector, 
    });

    await chatGptConnector.startChatGptSession();
    await slackBot.startListen();
}

main().catch(err => {
    console.error(err);
});


