import { Bot } from 'mineflayer';
import { BotWithLogger } from './types.js';

interface BotInstance {
    id: string;
    username: string;
    bot: BotWithLogger;
    createdAt: Date;
}

export class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private activeBotId: string | null = null;

    addBot(username: string, bot: BotWithLogger): string {
        const id = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.bots.set(id, {
            id,
            username,
            bot,
            createdAt: new Date()
        });

        // Set as active bot if it's the first one
        if (this.bots.size === 1) {
            this.activeBotId = id;
        }

        console.error(`[BotManager] Added bot '${username}' with ID: ${id}`);
        console.error(`[BotManager] Active bot is now: ${this.activeBotId}`);
        console.error(`[BotManager] Total bots: ${this.bots.size}`);

        // Handle bot events
        bot.on('error', (err) => {
            console.error(`[BotManager] Bot ${username} error:`, err);
        });

        bot.on('kicked', (reason) => {
            console.error(`[BotManager] Bot ${username} was kicked:`, reason);
            this.removeBot(id);
        });

        bot.on('end', () => {
            console.error(`[BotManager] Bot ${username} disconnected`);
            this.removeBot(id);
        });

        // Add more event logging
        bot.on('spawn', () => {
            console.error(`[BotManager] Bot ${username} spawned at position:`, bot.entity.position);
        });

        bot.on('death', () => {
            console.error(`[BotManager] Bot ${username} died`);
        });

        bot.on('health', () => {
            console.error(`[BotManager] Bot ${username} health: ${bot.health}, food: ${bot.food}`);
        });

        return id;
    }

    removeBot(idOrUsername: string): void {
        // First try to find by ID
        let botInstance = this.bots.get(idOrUsername);

        // If not found by ID, search by username
        if (!botInstance) {
            for (const [id, instance] of this.bots) {
                if (instance.username === idOrUsername) {
                    botInstance = instance;
                    idOrUsername = id; // Use the ID for deletion
                    break;
                }
            }
        }

        if (botInstance) {
            console.error(`[BotManager] Removing bot '${botInstance.username}' with ID: ${botInstance.id}`);
            try {
                botInstance.bot.quit();
            } catch (error) {
                // Bot might already be disconnected
            }
            this.bots.delete(idOrUsername);

            // Update active bot if needed
            if (this.activeBotId === idOrUsername) {
                const remainingBots = Array.from(this.bots.keys());
                this.activeBotId = remainingBots.length > 0 ? remainingBots[0] : null;
                console.error(`[BotManager] Active bot updated to: ${this.activeBotId}`);
            }
        }
    }

    getBot(id: string): BotWithLogger | null {
        const botInstance = this.bots.get(id);
        return botInstance ? botInstance.bot : null;
    }

    getActiveBot(): BotWithLogger | null {
        if (!this.activeBotId) {
            console.error(`[BotManager] No active bot available`);
            return null;
        }
        const bot = this.getBot(this.activeBotId);
        if (bot) {
            console.error(`[BotManager] Returning active bot with ID: ${this.activeBotId}`);
        }
        return bot;
    }

    setActiveBot(id: string): boolean {
        if (this.bots.has(id)) {
            this.activeBotId = id;
            console.error(`[BotManager] Set active bot to ID: ${id}`);
            return true;
        }
        return false;
    }

    getAllBots(): BotInstance[] {
        return Array.from(this.bots.values());
    }

    getBotByUsername(username: string): BotWithLogger | null {
        for (const instance of this.bots.values()) {
            if (instance.username === username) {
                return instance.bot;
            }
        }
        return null;
    }

    getBotCount(): number {
        return this.bots.size;
    }

    disconnectAll(): void {
        console.error(`[BotManager] Disconnecting all ${this.bots.size} bots`);
        for (const [id] of this.bots) {
            this.removeBot(id);
        }
    }
} 