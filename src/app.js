import { ChatGPTAPIBrowser } from 'chatgpt'
import puppeteer from "puppeteer";
import bolt from "@slack/bolt";
import { WebClient } from '@slack/web-api';

/**
 * @typedef SlackMeta
 * @property {string} ts
 * @property {string} channel
 * @property {string} thread_ts
 */

/**
 * @typedef SlackFn
 * @property {bolt.SayFn} say
 * @property {WebClient} client
 */

/**
 * @typedef ChatGtpSlackBotArgs
 * @property {string} chatGptAccEmail
 * @property {string} chatGptAccPassword
 * @property {boolean} chatGptIsGoogleLogin
 * @property {string|undefined} chatGptProxyServer
 * @property {string} slackBotToken
 * @property {string} slackAppToken
 */

class ChatGtpSlackBot {

    /**
     * @param {ChatGtpSlackBotArgs} args 
     */
    constructor(args) {
        
        this.chatApi = new ChatGPTAPIBrowser({
            email: args.chatGptAccEmail,
            password: args.chatGptAccPassword,
            proxyServer: args.chatGptProxyServer,
            isGoogleLogin: args.chatGptIsGoogleLogin,
            executablePath: puppeteer.executablePath(),
        });

        this.slackApp = new bolt.App({
            token: args.slackBotToken,
            appToken: args.slackAppToken,
            socketMode: true
        });

        this._setupSlackListener();
    }

    /**
     * Setup listeners that listen to 1) Direct Message to Bot and 2) bot mention in channels
     */
    _setupSlackListener() {

        this.slackApp.message(async ({ message, client, say }) => {
            console.log(`[${new Date().toISOString()}] received_im ${JSON.stringify(message)}`);
            const { ts, thread_ts, channel, text } = message;
            if (!text) {
                return;
            }
            this._interactSlack(text, { channel, ts, thread_ts }, { client, say });
        });
    
        this.slackApp.event('app_mention', async ({ event, client, say }) => {
    
            console.log(`[${new Date().toISOString()}] received_mention ${JSON.stringify(event)}`);
    
            const userIdTag = `<@${process.env.SLACK_BOT_USER_ID}>`;
            const { text, ts, channel, thread_ts } = event;
            if (!text.includes(userIdTag)) {
                return;
            }
            // Extract user prompt
            const prompt = text.replace(userIdTag, '').trim();
            this._interactSlack(prompt, { ts, thread_ts, channel }, { client, say });
        });
    }

    /**
     * Start a headless browser to connect and login to chatgpt
     * @returns {Promise<void>}
     */
    async startChatGptSession() {
        console.log('Start connecting ChatGPT session...');
        await this.chatApi.initSession();
    }

    /**
     * Start listen to slack events
     * @returns {Promise<void>}
     */
    async listenSlack() {
        console.info('Start listening to slack requests.');
        await this.slackApp.start();
    }

    /**
     * Check if ChatGpt still authenticated. If not, refresh the session and give wait for 30 sec before returning
     * @returns {Promise<void>}
     */
    async ensureChatGptLogin() {
        if (!await this.chatApi.getIsAuthenticated()) {
            console.info('Not authenticated, refreshing session...');
            await this.chatApi.refreshSession();
            // wait for 30 seconds
            await new Promise(r => setTimeout(r, 30000));
            console.info('Authentication completed.');
        } 
    }

    /**
     * In case the user is asking follow-up question in thread, try to obtain the previous chatgpt answer from the thread.
     * @param {string} channel 
     * @param {string} thread_ts 
     * @param {WebClient} client
     * @return {Promise<{conversationId: string, parentMessageId: string}>}
     */
    async _findPreviousChatGptMessage(channel, thread_ts, client) {
        
        const replies = await client.conversations.replies({ channel, ts: thread_ts });
        if (replies?.messages) {
            for (let i = replies.messages.length - 1; i >= 0; i--) {
                if (replies.messages[i].user === process.env.SLACK_BOT_USER_ID) {
                    // message is sent by this bot
                    const text = replies.messages[i].text;
                    const matches = text ? /.*_ref:(\S*):(\S*)_/.exec(text) : null;
                    if (matches) {
                        return {
                            conversationId: matches[1],
                            parentMessageId: matches[2],
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * @param {string} prompt 
     * @param {SlackMeta} msgMeta 
     * @param {SlackFn} slackFn 
     * @returns 
     */
    async _interactSlack(prompt, msgMeta, slackFn) {

        if (prompt.trim().length === 0) {
            return;
        }

        await this.ensureChatGptLogin();
        
        let prevAns = undefined;
        if (msgMeta.thread_ts) {
            prevAns = await this._findPreviousChatGptMessage(msgMeta.channel, msgMeta.thread_ts, slackFn.client);
        }
        
        try {
            // Leave loading reaction
            const reaction = await slackFn.client.reactions.add({ channel: msgMeta.channel, name: 'loading', timestamp: msgMeta.ts });
    
            console.log(`[${new Date().toISOString()}] chatgpt_request ${JSON.stringify({ prevAns, prompt })}`);
            const result = await this.chatApi.sendMessage(prompt, {
                conversationId: prevAns?.conversationId,
                parentMessageId: prevAns?.parentMessageId,
                timeoutMs: 5 * 60 * 1000
            });
            console.log(`[${new Date().toISOString()}] chatgpt_response ${JSON.stringify(result)}`);
            await slackFn.say({ 
                thread_ts: msgMeta.ts, 
                text: `>${prompt}${prevAns ? ' (follow-up)' : ''}\n${result.response}\n\n_ref:${result.conversationId}:${result.messageId}_`
            });
            
            // Add complete reaction
            await slackFn.client.reactions.add({ channel: msgMeta.channel, name: 'white_check_mark', timestamp: msgMeta.ts });
        } catch (err) {
            console.error(err);
            // Add error reaction
            await slackFn.client.reactions.add({ channel: msgMeta.channel, name: 'x', timestamp: msgMeta.ts });
            await slackFn.say({ 
                thread_ts: msgMeta.ts, 
                text: `Error: ${err.message} \nPlease ask again...`
            });
        } finally {
            // Remove loading reaction
            await slackFn.client.reactions.remove({ channel: msgMeta.channel, name: 'loading', timestamp: msgMeta.ts });
        }
    }
}

async function main() {

    if (!process.env.CHATGPT_EMAIL || !process.env.CHATGPT_PASSWORD) {
        throw new Error('Missing email / password');
    };

    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
        throw new Error('Missing slack token');
    };

    const bot = new ChatGtpSlackBot({
        chatGptAccEmail: process.env.CHATGPT_EMAIL,
        chatGptAccPassword: process.env.CHATGPT_PASSWORD,
        chatGptIsGoogleLogin: Boolean(Number(process.env.IS_GOOGLE_LOGIN)),
        chatGptProxyServer: process.env.PROXY_SERVER,
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        slackAppToken: process.env.SLACK_APP_TOKEN,
        
    });
    await bot.startChatGptSession();
    await bot.listenSlack();
}

main().catch(err => {
    console.error(err);
});


