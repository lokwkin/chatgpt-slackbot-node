import { ChatGPTAPIBrowser } from 'chatgpt'
import RedisAgent from './redis-agent.js';
import puppeteer from "puppeteer";
import crypto from 'crypto';

/**
 * @typedef ChatGptClientArgs
 * @property {string} accEmail
 * @property {string} accPassword
 * @property {boolean} [isGoogleLogin]
 * @property {string|undefined} [proxyServer]
 * @property {number} [requestTimeoutMs]
 */

/**
 * @typedef ChatGptQuestion
 * @property {string} prompt
 * @property {string} [conversationId]
 * @property {string} [parentMessageId]
 */

/**
 * @typedef ChatGptAnswer
 * @property {string} response
 * @property {string} conversationId
 * @property {string} messageId
 */

/**
 * @callback AnswerCallback
 * @param {ChatGptAnswer} answer
 * @param {ChatGptQuestion} question
 * @param {SlackMeta} slackMeta
 * @param {string} chatgptClientId
 */

/**
 * @callback ErrorCallback
 * @param {Error} err
 * @param {ChatGptQuestion} question
 * @param {SlackMeta} slackMeta
 * @param {string} chatgptClientId
 */


class ChatGptClient {

    /**
     * @param {ChatGptClientArgs} args 
     */
    constructor(args) {

        this.chatApi = new ChatGPTAPIBrowser({
            email: args.accEmail,
            password: args.accPassword,
            proxyServer: args.proxyServer ?? undefined,
            isGoogleLogin: args.isGoogleLogin ?? false,
            executablePath: puppeteer.executablePath(),
        });

        /** @type {ChatGptClientArgs} */
        this.accEmail = args.accEmail;

        /** @type {string} */
        this.clientId = this._obtainClientId();

        /** @type {number} */
        this.requestTimeoutMs = args.requestTimeoutMs ?? 5 * 60 * 1000;

        /** @type {AnswerCallback} */
        this.answerCallback = null;

        /** @type {ErrorCallback} */
        this.errorCallback = null;
    }

    /**
     * @param {AnswerCallback} answerCallback
     * @param {ErrorCallback} errorCallback
     */
    setCallbacks(answerCallback, errorCallback) {
        this.answerCallback = answerCallback;
        this.errorCallback = errorCallback;
    }

    /**
     * Ask ChatGPT asyncrhonously
     * @param {ChatGptQuestion} question
     * @param {SlackMeta} slackMeta
     * @param {string} [chatgptClientId]
     * @return {Promise<ChatResponse>}
     */
    static async ask(question, slackMeta, chatgptClientId = undefined) {

        if (chatgptClientId) {
            await RedisAgent.getInstance().enqueue(`ChatGptClient.${chatgptClientId}`, { question, slackMeta });
        } else {
            await RedisAgent.getInstance().enqueue(`ChatGptClient.COMMON`, { question, slackMeta });
        }
    }

    /**
     * Start a headless browser to connect and login to chatgpt
     * @returns {Promise<void>}
     */
    async startChatGptSession() {
        console.info(`[${new Date().toISOString()}] CHATGPT_CONNECTING_SESSION`);
        try {
            await this.chatApi.initSession();
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    }

    /**
     * Start listening to queues. Note each client listens to 2 queues: Common Queue and Account Specific Queue.
     * The account specific queue is used in case that a root question is processed by a specific account previously 
     * therefore its follow-up must also be processed by the same account.
     */
    async startListenQueue() {
        console.info(`[${new Date().toISOString()}] CHATGPT_START_LISTEN_QUEUE`);
        while (true) {
            await this._popAndHandle(`ChatGptClient.COMMON`);
            await this._popAndHandle(`ChatGptClient.${this.clientId}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    /**
     * Pops one item from queue and try to handle it
     * @param {string} queueName 
     */
    async _popAndHandle(queueName) {
        let item = await RedisAgent.getInstance().dequeue(queueName);
        if (item) {
            try {
                const answer = await this._handleAsk(item.question, true);
                await this.answerCallback(answer, item.question, item.slackMeta, this.clientId);
            } catch (err) {
                await this.errorCallback(err, item.question, item.slackMeta, this.clientId);
            }
        }
    }

    /**
     * Handle a question
     * @param {ChatGptQuestion} question 
     * @param {boolean} shouldRetry 
     * @returns {ChatGptAnswer}
     */
    async _handleAsk(question, shouldRetry) {
        try {
            console.info(`[${new Date().toISOString()}] CHATGPT_REQUEST <${this.accEmail}> ${JSON.stringify({ question, shouldRetry })}`);
            
            const result = await this.chatApi.sendMessage(question.prompt, {
                conversationId: question.conversationId,
                parentMessageId: question.parentMessageId,
                timeoutMs: this.requestTimeoutMs,
            });
            console.info(`[${new Date().toISOString()}] CHATGPT_RESPONSE <${this.accEmail}> ${JSON.stringify(result)}`); 
            return result;

        } catch (err) {
            console.info(`[${new Date().toISOString()}] CHATGPT_ERROR <${this.accEmail}> ${JSON.stringify({ err })}`);

            if (shouldRetry && err.message?.includes('403')) {
                console.info(`[${new Date().toISOString()}] CHATGPT_REFRESH_SESSION <${this.accEmail}>`);
                await this.chatApi.refreshSession();
                await new Promise(r => setTimeout(r, 10000));
                return await this.ask(question, false);
            } else {
                throw err;
            }
        }
    }

    /**
     * Returns a hash string from account email 
     */
    _obtainClientId() {
        const hash = crypto.createHash('sha256');
        hash.update(this.accEmail);
        const hashedEmail = hash.digest('hex');
        return hashedEmail.substring(0, 8);
    }
}

export { ChatGptClient as default }