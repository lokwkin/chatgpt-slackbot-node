import bolt from "@slack/bolt";
import { ChatGPTAPIBrowser } from 'chatgpt'
import puppeteer from "puppeteer";

/**
 * @type ChatGPTAPIBrowser
 */
let chatApi = null;

/**
 * @param {string} prompt
 * @param {WebClient} client
 * @param {bolt.SayFn} arg.say
 * @param {number} thread_ts
 * @param {string} channel 
 */
async function reactToPrompt(prompt, { client, say, ts, thread_ts, channel }) {

    if (!prompt || prompt.trim().length === 0) {
        return;
    }

    if (!await chatApi.getIsAuthenticated()) {
        await chatApi.refreshSession();
    } 
    
    let conversationId, parentMessageId, isFollowUp = false;

    if (thread_ts) {
        // This is user follow-up question. Obtain the previous answer.
        const replies = await client.conversations.replies({ channel, ts: thread_ts });
        for (let i = replies.messages.length - 1; i >= 0; i--) {
            if (replies.messages[i].user === process.env.SLACK_BOT_USER_ID) {
                // message is sent by this bot
                const matches = /.*_ref:(\S*):(\S*)_/.exec(replies.messages[i].text);
                if (matches) {
                    isFollowUp = true;
                    conversationId = matches[1];
                    parentMessageId = matches[2];
                    break;
                }

            }
        }
    }
    
    try {
        // Leave loading reaction
        const reaction = await client.reactions.add({ channel: channel, name: 'loading', timestamp: ts });

        console.log(`[${new Date().toISOString()}] ChatGPT Sending ${JSON.stringify({ conversationId, parentMessageId, prompt })}`);
        const result = await chatApi.sendMessage(prompt, {
            conversationId,
            parentMessageId,
            timeoutMs: 5 * 60 * 1000
        });
        console.log(`[${new Date().toISOString()}] ChatGPT Response ${JSON.stringify(result)}`);
        await say({ 
            thread_ts: ts, 
            text: `>${prompt}${isFollowUp ? ' (follow-up)' : ''}\n${result.response}\n\n_ref:${result.conversationId}:${result.messageId}_`
        });
        
        // Add complete reaction
        await client.reactions.add({ channel: channel, name: 'white_check_mark', timestamp: ts });
    } catch (err) {
        console.error(err);
        // Add error reaction
        await client.reactions.add({ channel: channel, name: 'x', timestamp: ts });
        await say({ 
            thread_ts: ts, 
            text: `Error: ${err.message} \nPlease ask again...`
        });
    } finally {
        // Remove loading reaction
        await client.reactions.remove({ channel: channel, name: 'loading', timestamp: ts });
    }

}

function setupSlackBot() {

    const slackApp = new bolt.App({
        token: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        socketMode: true
    });

    slackApp.message(async ({ message, client, say }) => {
        console.log(`[${new Date().toISOString()}] Received IM ${JSON.stringify(message)}`);
        const { ts, thread_ts, channel, text } = message;
        reactToPrompt(text, { client, say, ts, thread_ts, channel });
    });

    slackApp.event('app_mention', async ({ event, client, say }) => {

        console.log(`[${new Date().toISOString()}] Received Mention ${JSON.stringify(event)}`);

        const userIdTag = `<@${process.env.SLACK_BOT_USER_ID}>`;
        const { text, ts, channel, thread_ts } = event;
        if (!text.includes(userIdTag)) {
            return;
        }
        // Extract user prompt
        const prompt = text.replace(userIdTag, '').trim();
        reactToPrompt(prompt, { client, say, ts, thread_ts, channel });
    });

    return slackApp;
}

async function startChatSession() {
    chatApi = new ChatGPTAPIBrowser({
        email: process.env.CHATGPT_EMAIL,
        password: process.env.CHATGPT_PASSWORD,
        proxyServer: process.env.PROXY_SERVER,
        isGoogleLogin: Boolean(Number(process.env.IS_GOOGLE_LOGIN)),
        executablePath: puppeteer.executablePath(),
    })
    console.log('Starting ChatGPT session...');
    await chatApi.initSession();
}

async function main() {
    await startChatSession();
    console.log('Setting up Slack Bot...');
    const slackBot = setupSlackBot();
    await slackBot.start();
    console.log('Slack Bot started');
}

main().catch(err => {
    console.error(err);
});


