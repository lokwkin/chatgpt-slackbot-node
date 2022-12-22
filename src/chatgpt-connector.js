import { ChatGPTAPIBrowser } from 'chatgpt'
import puppeteer from "puppeteer";

/**
 * @typedef ChatGptConnectorArgs
 * @property {string} accEmail
 * @property {string} accPassword
 * @property {boolean} [isGoogleLogin]
 * @property {string|undefined} [proxyServer]
 */


class ChatGptConnector {

    /**
     * @param {ChatGptConnectorArgs} args 
     */
    constructor(args) {

        this.chatApi = new ChatGPTAPIBrowser({
            email: args.accEmail,
            password: args.accPassword,
            proxyServer: args.proxyServer ?? undefined,
            isGoogleLogin: args.isGoogleLogin ?? false,
            executablePath: puppeteer.executablePath(),
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
     * Ask ChatGPT
     * @param {string} prompt 
     * @param {string} [conversationId] 
     * @param {string} [parentMessageId] 
     * @param {boolean} [shouldRetry]
     * @return {Promise<ChatResponse>}
     */
    async ask(prompt, conversationId, parentMessageId, shouldRetry = true) {
        console.log(`[${new Date().toISOString()}] chatgpt_request ${JSON.stringify({ prompt, conversationId, parentMessageId })}`);

        let result = null;
        try {
            result = await this.chatApi.sendMessage(prompt, {
                conversationId: prevAns?.conversationId,
                parentMessageId: prevAns?.parentMessageId,
                timeoutMs: 5 * 60 * 1000
            });
        } catch (err) {
            if (shouldRetry && err.message?.includes('403')) {
                await this.chatApi.refreshSession();
                await new Promise(r => setTimeout(r, 10000));
                result = await this.ask(prompt, conversationId, parentMessageId, false);
            }
        }

        if (!result) {
            throw new Error('Failed to obtain ChatGPT result');
        }
        
        console.log(`[${new Date().toISOString()}] chatgpt_response ${JSON.stringify(result)}`); 
        return result;
    }
}
export { ChatGptConnector as default }