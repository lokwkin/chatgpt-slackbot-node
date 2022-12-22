import bolt from "@slack/bolt";
import { WebClient } from '@slack/web-api';
import ChatGptConnector from './chatgpt-connector.js';

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
 * @property {string} slackBotToken
 * @property {string} slackAppToken
 * @property {ChatGptConnector} chatGptConnector
 */

class ChatGtpSlackBot {

    /**
     * @param {ChatGtpSlackBotArgs} args 
     */
    constructor(args) {

        this.slackApp = new bolt.App({
            token: args.slackBotToken,
            appToken: args.slackAppToken,
            socketMode: true
        });

        /**
         * @type {ChatGptConnector}
         */
        this.chatGptConnector = args.chatGptConnector;

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
     * Start listen to slack events
     * @returns {Promise<void>}
     */
    async startListen() {
        console.info('Start listening to slack requests.');
        await this.slackApp.start();
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

        
        let prevAns = undefined;
        if (msgMeta.thread_ts) {
            prevAns = await this._findPreviousChatGptMessage(msgMeta.channel, msgMeta.thread_ts, slackFn.client);
        }
        
        try {
            // Leave loading reaction
            const reaction = await slackFn.client.reactions.add({ channel: msgMeta.channel, name: 'loading', timestamp: msgMeta.ts });
    
            const result = await this.chatGptConnector.ask(prompt, prevAns?.conversationId, prevAns?.parentMessageId);

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

export { ChatGtpSlackBot as default }