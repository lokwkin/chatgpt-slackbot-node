import ChatGptClient from './chatgpt-client.js';
import ChatGtpSlackBot from './slackbot.js';
import RedisAgent from './redis-agent.js';

import dotenv from 'dotenv';

dotenv.config();

const START_MODE_OPTIONS = ['slackbot', 'chatgpt'];

async function main() {

    if (!START_MODE_OPTIONS.includes(process.env.START_MODE)) {
        throw new Error('Invalid start mode');
    }

    RedisAgent.initialize({
        redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    });

    if (process.env.START_MODE === 'slackbot') {

        if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
            throw new Error('Missing slack token');
        };
    
        const slackBot = new ChatGtpSlackBot({
            slackBotToken: process.env.SLACK_BOT_TOKEN,
            slackAppToken: process.env.SLACK_APP_TOKEN,
            reactions: {
                loading: process.env.SLACK_REACTION_LOADING,
                success: process.env.SLACK_REACTION_SUCCESS,
                failed: process.env.SLACK_REACTION_FAILED,
            },
            chatGptResponseQueue: process.env.CHATGPT_RESPONSE_QUEUE_NAME || 'queues.answers.slackbot'
        });
        
        await slackBot.listen();
        
    } else if (process.env.START_MODE === 'chatgpt') {

        if (!process.env.CHATGPT_EMAIL || !process.env.CHATGPT_PASSWORD) {
            throw new Error('Missing email / password');
        };

        const chatGptClient = new ChatGptClient({
            accEmail: process.env.CHATGPT_EMAIL,
            accPassword: process.env.CHATGPT_PASSWORD,
            isGoogleLogin: Boolean(Number(process.env.CHATGPT_IS_GOOGLE_LOGIN)),
            proxyServer: process.env.CHATGPT_PROXY_SERVER,
            requestTimeoutMs: Number(process.env.CHATGPT_REQUEST_TIMEOUT_MS || 300000),
        });

        await chatGptClient.startChatGptSession();
        await chatGptClient.listenQuestion();
    }

}

main().catch(err => {
    console.error(err);
});


