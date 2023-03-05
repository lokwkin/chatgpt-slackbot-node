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

        if (!process.env.OPENAI_API_KEY) {
            throw new Error('Missing api key');
        };

        const chatGptClient = new ChatGptClient({
            apiKey: process.env.OPENAI_API_KEY,
            requestTimeoutMs: Number(process.env.CHATGPT_REQUEST_TIMEOUT_MS || 300000),
            completionParams: {
                temperature: Number(process.env.CHATGPT_PARAM_TEMPERATURE || 0.5),
                top_p: Number(process.env.CHATGPT_PARAM_TOP_P || 0.8),
                presence_penalty: Number(process.env.CHATGPT_PARAM_PRESENSE_PENALTY || 0.3),
                frequency_penalty: Number(process.env.CHATGPT_PARAM_FREQUENCY_PENALTY || 0.5),
            },
        });

        await chatGptClient.listenQuestion();
    }

}

main().catch(err => {
    console.error(err);
});


