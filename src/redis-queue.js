import redis from '@redis/client';

/**
 * @typedef RedisQueueArg
 * @property {string} redisUrl
 */

class RedisQueue {

    /**
     * @param {RedisQueueArg} args 
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
        console.log(`[${new Date().toISOString()}] enqueue ${JSON.stringify(message)}`)
        // use the RPUSH command to add the message to the end of the list
        await this.client.rPush(queueName, JSON.stringify(message));
    }

    /**
     * @param {string} queueName 
     * @returns {any}
     */
    async dequeue(queueName) {
        // use the LPOP command to remove the first message from the list
        const message = await this.client.lPop(queueName);
        if (!message) {
            return null;
        }
        const result = JSON.parse(message);
        console.log(`[${new Date().toISOString()}] dequeue ${JSON.stringify(message)}`)
        return result;
    }

    /**
     * @param {RedisQueueArg} args
     */
    static async initialize(args) {
        RedisQueue._instance = new RedisQueue(args);
        await RedisQueue._instance.connect();
    }
    
    /**
     * @returns {RedisQueue}
     */
    static getInstance() {
        if (!RedisQueue._instance) {
            throw new Error('RedisQueue not initialized');
        }
        return RedisQueue._instance;
    }
}

export { RedisQueue as default }