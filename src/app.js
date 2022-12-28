import ChatGptClient from './chatgpt-client.js';
import ChatGtpSlackBot from './slackbot.js';
import RedisQueue from './redis-queue.js';

import dotenv from 'dotenv';

dotenv.config();

const START_MODE_OPTIONS = ['slackbot', 'chatgpt'];

async function main() {

    if (!START_MODE_OPTIONS.includes(process.env.START_MODE)) {
        throw new Error('Invalid start mode');
    }
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
        throw new Error('Missing slack token');
    };

    RedisQueue.initialize({
        redisUrl: process.env.REDIS_URL,
    });

    const slackBot = new ChatGtpSlackBot({
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        slackAppToken: process.env.SLACK_APP_TOKEN,
    });

    if (process.env.START_MODE === 'slackbot') {
        await slackBot.listen();
        
    } else if (process.env.START_MODE === 'chatgpt') {

        if (!process.env.CHATGPT_EMAIL || !process.env.CHATGPT_PASSWORD) {
            throw new Error('Missing email / password');
        };

        const chatGptClient = new ChatGptClient(0, {
            accEmail: process.env.CHATGPT_EMAIL,
            accPassword: process.env.CHATGPT_PASSWORD,
            isGoogleLogin: Boolean(Number(process.env.IS_GOOGLE_LOGIN)),
            proxyServer: process.env.PROXY_SERVER,
        });

        chatGptClient.setCallbacks(async (answer, question, slackMeta) => {
            await slackBot.replyAnswer(answer, question, slackMeta);
        }, async (error, question, slackMeta) => {
            await slackBot.replyError(error, question, slackMeta);
        });

        await chatGptClient.startChatGptSession();
        await chatGptClient.startListenQueue();
        
    }

}

main().catch(err => {
    console.error(err);
});


