import bolt from "@slack/bolt";
import { WebClient } from '@slack/web-api';
import ChatGptClient from './chatgpt-client.js';

/**
 * @typedef SlackMeta
 * @property {string} ts
 * @property {string} channel
 * @property {string} thread_ts
 */

/**
 * @typedef ChatGtpSlackBotArgs
 * @property {string} slackBotToken
 * @property {string} slackAppToken
 * @property {object} reactions
 * @property {string} reactions.loading
 * @property {string} reactions.success
 * @property {string} reactions.failed
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

        /** @type {{loading:string, success:string, failed:string}} */
        this.reactions = {
            loading: args.reactions?.loading || 'thinking_face',
            success: args.reactions?.success || 'white_check_mark',
            failed: args.reactions?.failed || 'x'
        };
    }

    /**
     * Start listen to slack events
     * @returns {Promise<void>}
     */
    async listen() {
        console.info(`[${new Date().toISOString()}] SLACK_START_LISTENING`);

        this.slackApp.message(async ({ message }) => {
            console.info(`[${new Date().toISOString()}] SLACK_RECEIVED_DIRECT_MESSAGE ${JSON.stringify(message)}`);
            const { ts, thread_ts, channel, text } = message;
            if (!text) {
                return;
            }
            this._ack(text, { channel, ts, thread_ts });
        });
    
        this.slackApp.event('app_mention', async ({ event }) => {
    
            console.info(`[${new Date().toISOString()}] SLACK_RECEIVED_MENTION ${JSON.stringify(event)}`);
    
            const userIdTag = `<@${process.env.SLACK_BOT_USER_ID}>`;
            const { text, ts, channel, thread_ts } = event;
            if (!text.includes(userIdTag)) {
                return;
            }
            // Extract user prompt
            const prompt = text.replace(userIdTag, '').trim();
            this._ack(prompt, { ts, thread_ts, channel });
        });

        await this.slackApp.start();
        await ChatGptClient.listenAnswer('queues.answers.chatgpt_slackbot', async (param) => {
            if (param.success) {
                await this._replyAnswer(param.answer, param.question, param.extra, param.handlerId);
            } else {
                await this._replyError(param.error, param.question, param.extra, param.handlerId);
            }
        });
    }


    /**
     * In case the user is asking follow-up question in thread, try to obtain the previous chatgpt answer from the thread.
     * @param {string} channel 
     * @param {string} thread_ts 
     * @return {Promise<{conversationId: string, parentMessageId: string, handlerId:string}>}
     */
    async _findPreviousChatGptMessage(channel, thread_ts) {
        
        const replies = await this.slackApp.client.conversations.replies({ channel, ts: thread_ts });
        if (replies?.messages) {
            for (let i = replies.messages.length - 1; i >= 0; i--) {
                if (replies.messages[i].user === process.env.SLACK_BOT_USER_ID) {
                    // message is sent by this bot
                    const text = replies.messages[i].text;
                    const matches = text ? /.*_ref:(\S*):(\S*):(\S*)_/.exec(text) : null;
                    if (matches) {
                        return {
                            conversationId: matches[1],
                            parentMessageId: matches[2],
                            handlerId: matches[3],
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * @param {ChatGptAnswer} answer 
     * @param {ChatGptQuestion} question 
     * @param {SlackMeta} slackMeta 
     * @param {string} chatgptHandlerId
     */
    async _replyAnswer(answer, question, slackMeta, chatgptHandlerId) {
        await this.slackApp.client.chat.postMessage({
            channel: slackMeta.channel,
            thread_ts: slackMeta.ts,
            text: `${answer.response}\n\n_ref:${answer.conversationId}:${answer.messageId}:${chatgptHandlerId}_`
        });
        if (this.reactions.success) {
            await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: this.reactions.success, timestamp: slackMeta.ts });
        }
        if (this.reactions.loading) {
            await this.slackApp.client.reactions.remove({ channel: slackMeta.channel, name: this.reactions.loading, timestamp: slackMeta.ts });
        }
    }

    /**
     * @param {Error} err
     * @param {ChatGptQuestion} question 
     * @param {SlackMeta} slackMeta 
     * @param {string} chatgptHandlerId
     */
    async _replyError(err, question, slackMeta, chatgptHandlerId) {
        await this.slackApp.client.chat.postMessage({
            channel: slackMeta.channel,
            thread_ts: slackMeta.ts, 
            text: `Error: ${err.message} \nPlease ask again...`
        });
        
        if (this.reactions.failed) {
            await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: this.reactions.failed, timestamp: slackMeta.ts });
        }
        if (this.reactions.loading) {
            await this.slackApp.client.reactions.remove({ channel: slackMeta.channel, name: this.reactions.loading, timestamp: slackMeta.ts });
        }
    }

    /**
     * @param {string} prompt 
     * @param {SlackMeta} slackMeta 
     * @returns 
     */
    async _ack(prompt, slackMeta) {

        if (prompt.trim().length === 0) {
            return;
        }

        let prevAns = undefined;
        if (slackMeta.thread_ts) {
            prevAns = await this._findPreviousChatGptMessage(slackMeta.channel, slackMeta.thread_ts, this.slackApp.client);
        }
        // Leave loading reaction
        if (this.reactions.loading) {
            const reaction = await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: this.reactions.loading, timestamp: slackMeta.ts });
        }

        /** @type {ChatGptQuestion} */
        const question = {
            prompt,
            conversationId: prevAns?.conversationId, 
            parentMessageId: prevAns?.parentMessageId,
        };
        
        await ChatGptClient.ask(question, {
            responseQueue: 'queues.answers.chatgpt_slackbot',
            handlerId: prevAns?.handlerId,
            extra: slackMeta
        });
    }
}

export { ChatGtpSlackBot as default }