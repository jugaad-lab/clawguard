/**
 * ClawGuard Discord Approval Handler
 * Sends approval requests to Discord for warnings
 */

import { loadConfig } from './config.js';

/**
 * Request approval from Discord for a warning
 * @param {Object} result - ClawGuard check result
 * @param {string} input - Original input (command/URL)
 * @returns {Promise<boolean>} - true if approved, false if denied/timeout
 */
export async function requestDiscordApproval(result, input) {
    const config = loadConfig();
    
    if (!config.discord.enabled || !config.discord.channelId) {
        // Discord not configured, default to deny
        return false;
    }
    
    const threat = result.primaryThreat;
    const message = formatApprovalMessage(input, result.checkType, threat);
    
    try {
        // This will be called from the plugin context where we have access to OpenClaw message tool
        // For now, we'll export this and let the plugin handle the actual message sending
        return await sendApprovalRequest(message, config.discord.channelId, config.discord.timeout);
    } catch (error) {
        console.error(`Discord approval error: ${error.message}`);
        return false; // Deny on error
    }
}

/**
 * Format the approval message
 */
function formatApprovalMessage(input, type, threat) {
    const emoji = {
        url: '🔗',
        command: '⚡',
        skill: '🧩',
        message: '💬'
    };
    
    let message = `⚠️ **ClawGuard Warning - Approval Required**\n\n`;
    message += `${emoji[type] || '🔍'} **Type:** ${type.toUpperCase()}\n`;
    message += `**Input:** \`${input.substring(0, 200)}${input.length > 200 ? '...' : ''}\`\n\n`;
    
    if (threat) {
        message += `**Threat Detected:** ${threat.name}\n`;
        message += `**Severity:** ${threat.severity.toUpperCase()}\n`;
        message += `**ID:** ${threat.id}\n\n`;
        
        if (threat.teaching_prompt) {
            message += `**Why this is flagged:**\n${threat.teaching_prompt.substring(0, 300)}${threat.teaching_prompt.length > 300 ? '...' : ''}\n\n`;
        }
    }
    
    message += `**Do you want to proceed?**\n`;
    message += `React with ✅ to approve or ❌ to deny (timeout: ${Math.floor((loadConfig().discord.timeout || 60000) / 1000)}s)`;
    
    return message;
}

/**
 * Send approval request and wait for response
 * This is a placeholder - actual implementation will be in the plugin
 */
async function sendApprovalRequest(message, channelId, timeout) {
    // This function will be implemented by the plugin that has access to OpenClaw's message tool
    // For library usage, we export the message formatter and let the caller handle sending
    throw new Error('sendApprovalRequest must be implemented by plugin context');
}

/**
 * Export for plugin use
 */
export { formatApprovalMessage };
