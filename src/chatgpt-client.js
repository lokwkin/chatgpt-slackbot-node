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
 * @property {string} [responseQueue]
 */

/**
 * @typedef ChatGptAnswer
 * @property {string} response
 * @property {string} conversationId
 * @property {string} messageId
 */

/**
 * @typedef ChatGptCallbackParam
 * @property {boolean} success
 * @property {string} handlerId
 * @property {ChatGptQuestion} question
 * @property {ChatGptAnswer} [answer]
 * @property {Error} [error]
 * @property {*} [extra]
 */

/**
 * @callback ChatGptCallback
 * @param {ChatGptCallbackParam} param
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
        this.handlerId = this._obtainHandlerId();

        /** @type {number} */
        this.requestTimeoutMs = args.requestTimeoutMs ?? 5 * 60 * 1000;
    }

    /**
     * Ask ChatGPT Asyncrhonously. Requests will be enqueued to a queue system for handlers to process. 
     * The result will be returned through an answer queue provided by caller.
     * @param {ChatGptQuestion} question Question
     * @param {object} opts
     * @param {string} opts.responseQueue The name of the queue that the answer should be enqueued to.
     * @param {string} [opts.handlerId] In case a specific handler should be used to answer the question. Mostly used in case of follow up questions.
     * @param {*} [opts.extra] Any extra information that will returned along with the answer.
     * @return {Promise<void>}
     */
    static async ask(question, opts) {

        const { responseQueue, handlerId, extra } = opts;

        if (handlerId) {
            await RedisAgent.getInstance().enqueue(`queues.questions.handler.${handlerId}`, { question, extra, responseQueue });
        } else {
            await RedisAgent.getInstance().enqueue(`queues.questions.handler.common`, { question, extra, responseQueue });
        }
    }

    /**
     * Start a headless browser to connect and login to chatgpt
     * @returns {Promise<void>}
     */
    async startChatGptSession() {
        console.info(`[${new Date().toISOString()}] CHATGPT_CONNECTING_SESSION <${this.accEmail}>`);
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
    async listenQuestion() {
        console.info(`[${new Date().toISOString()}] CHATGPT_START_LISTEN_QUEUE <${this.accEmail}>`);
        while (true) {
            await this._popAndHandle(`queues.questions.handler.common`);
            await this._popAndHandle(`queues.questions.handler.${this.handlerId}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    /**
     * @param {string} answerQueueName
     * @param {ChatGptCallback} callback 
     */
    static async listenAnswer(answerQueueName, callback) {
        while (true) {
            /** @type {ChatGptCallbackParam} */
            let item = await RedisAgent.getInstance().dequeue(answerQueueName);
            if (item) {
                await callback(item);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    /**
     * Pops one item from queue and try to handle it. 
     * @param {string} queueName 
     */
    async _popAndHandle(queueName) {
        let item = await RedisAgent.getInstance().dequeue(queueName);
        if (item) {
            try {
                const answer = await this._handleAsk(item.question, true);
                await RedisAgent.getInstance().enqueue(item.responseQueue, {
                    success: true,
                    answer,
                    question: item.question,
                    extra: item.extra,
                    handlerId: this.handlerId
                });
            } catch (err) {
                await RedisAgent.getInstance().enqueue(item.responseQueue, {
                    success: false,
                    error: err,
                    question: item.question,
                    extra: item.extra,
                    handlerId: this.handlerId
                });
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
                return await this._handleAsk(question, false);
            } else {
                throw err;
            }
        }
    }

    /**
     * Returns a hash string from account email 
     */
    _obtainHandlerId() {
        const hash = crypto.createHash('sha256');
        hash.update(this.accEmail);
        const hashedEmail = hash.digest('hex');
        return hashedEmail.substring(0, 8);
    }
}

export { ChatGptClient as default }