import redis from '@redis/client';

/**
 * @typedef RedisAgentArg
 * @property {string} redisUrl
 */

class RedisAgent {

    /**
     * @param {RedisAgentArg} args 
     */
    constructor(args) {
        // create a client for connecting to Redis
        this.client = redis.createClient({
            url: args.redisUrl,
        });

        // set up error handling for the client
        this.client.on('error', (err) => {
            console.error(`Error: ${err}`);
        });
    }

    async connect() {
        await this.client.connect();
    }

    /**
     * @param {string} queueName 
     * @param {any} message 
     */
    async enqueue(queueName, message) {
        // use the RPUSH command to add the message to the end of the list
        await this.client.rPush(queueName, JSON.stringify(message));
    }

    /**
     * @param {string} queueName 
     * @returns {Promise<any>}
     */
    async dequeue(queueName) {
        // use the LPOP command to remove the first message from the list
        const message = await this.client.lPop(queueName);
        if (!message) {
            return null;
        }
        const result = JSON.parse(message);
        return result;
    }

    /**
     * @param {string} key
     * @returns {Promise<string>}
     */
    async get(key) {
        return await this.client.GET(key);
    }

    /**
     * @param {string} key 
     * @param {string} value 
     */
    async set(key, value) {
        await this.client.SETEX(key, 86400, value); // 1 day TTL
    }

    /**
     * @param {RedisAgentArg} args
     */
    static async initialize(args) {
        RedisAgent._instance = new RedisAgent(args);
        await RedisAgent._instance.connect();
    }
    
    /**
     * @returns {RedisAgent}
     */
    static getInstance() {
        if (!RedisAgent._instance) {
            throw new Error('RedisAgent not initialized');
        }
        return RedisAgent._instance;
    }
}

export { RedisAgent as default }