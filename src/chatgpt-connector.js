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
     * Ask ChatGPT
     * @param {string} prompt 
     * @param {string} [conversationId] 
     * @param {string} [parentMessageId] 
     * @return {Promise<ChatResponse>}
     */
    async ask(prompt, conversationId, parentMessageId) {
        await this.ensureChatGptLogin();
        console.log(`[${new Date().toISOString()}] chatgpt_request ${JSON.stringify({ prompt, conversationId, parentMessageId })}`);
        const result = await this.chatApi.sendMessage(prompt, {
            conversationId: prevAns?.conversationId,
            parentMessageId: prevAns?.parentMessageId,
            timeoutMs: 5 * 60 * 1000
        });
        console.log(`[${new Date().toISOString()}] chatgpt_response ${JSON.stringify(result)}`); 
        return result;
    }
}
export { ChatGptConnector as default }