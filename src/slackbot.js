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
    }


    /**
     * In case the user is asking follow-up question in thread, try to obtain the previous chatgpt answer from the thread.
     * @param {string} channel 
     * @param {string} thread_ts 
     * @return {Promise<{conversationId: string, parentMessageId: string}>}
     */
    async _findPreviousChatGptMessage(channel, thread_ts) {
        
        const replies = await this.slackApp.client.conversations.replies({ channel, ts: thread_ts });
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
     * @param {ChatGptAnswer} answer 
     * @param {ChatGptQuestion} question 
     * @param {SlackMeta} slackMeta 
     */
    async replyAnswer(answer, question, slackMeta) {
        await this.slackApp.client.chat.postMessage({
            channel: slackMeta.channel,
            thread_ts: slackMeta.ts,
            // text: `>${question.prompt}${question.parentMessageId ? ' (follow-up)' : ''}\n${answer.response}\n\n_ref:${answer.conversationId}:${answer.messageId}_`
            text: `${answer.response}\n\n_ref:${answer.conversationId}:${answer.messageId}_`
        });
        await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: 'white_check_mark', timestamp: slackMeta.ts });
        await this.slackApp.client.reactions.remove({ channel: slackMeta.channel, name: 'loading', timestamp: slackMeta.ts });
    }

    /**
     * @param {Error} err
     * @param {ChatGptQuestion} question 
     * @param {SlackMeta} slackMeta 
     */
    async replyError(err, question, slackMeta) {
        await this.slackApp.client.chat.postMessage({
            channel: slackMeta.channel,
            thread_ts: slackMeta.ts, 
            text: `>${question.prompt}${question.parentMessageId ? ' (follow-up)' : ''}\nError: ${err.message} \nPlease ask again...`
        });
        
        await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: 'x', timestamp: slackMeta.ts });
        await this.slackApp.client.reactions.remove({ channel: slackMeta.channel, name: 'loading', timestamp: slackMeta.ts });
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
        const reaction = await this.slackApp.client.reactions.add({ channel: slackMeta.channel, name: 'loading', timestamp: slackMeta.ts });
        await ChatGptClient.ask({
            prompt,
            conversationId: prevAns?.conversationId, 
            parentMessageId: prevAns?.parentMessageId
        }, slackMeta);
    }
}

export { ChatGtpSlackBot as default }