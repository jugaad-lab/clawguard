/**
 * ClawGuard OpenClaw Plugin
 * Hooks into before_tool_call to auto-check commands and URLs
 */

import { getDetector, RESULT, EXIT_CODE } from './lib/detector.js';
import { loadConfig } from './lib/config.js';
import { formatApprovalMessage } from './lib/discord-approval.js';

/**
 * Plugin metadata
 */
export const metadata = {
    name: 'clawguard-security',
    version: '1.2.0',
    description: 'Automatic security checks for all tool calls',
    hooks: ['before_tool_call']
};

/**
 * Extract commands from exec tool calls
 */
function extractCommand(toolCall) {
    if (toolCall.tool === 'exec' && toolCall.parameters?.command) {
        return toolCall.parameters.command;
    }
    return null;
}

/**
 * Extract URLs from browser/web_fetch tool calls
 */
function extractUrls(toolCall) {
    const urls = [];
    
    if (toolCall.tool === 'web_fetch' && toolCall.parameters?.url) {
        urls.push(toolCall.parameters.url);
    }
    
    if (toolCall.tool === 'browser') {
        if (toolCall.parameters?.targetUrl) {
            urls.push(toolCall.parameters.targetUrl);
        }
        if (toolCall.parameters?.action === 'open' && toolCall.parameters?.targetUrl) {
            urls.push(toolCall.parameters.targetUrl);
        }
    }
    
    return urls;
}

/**
 * Send Discord approval request and wait for response
 * This function expects to be called from OpenClaw context with access to message tool
 */
async function requestDiscordApproval(message, channelId, timeout, context) {
    if (!context || !context.message) {
        console.error('ClawGuard: message tool not available in context');
        return false;
    }
    
    try {
        // Send approval request
        const sentMessage = await context.message({
            action: 'send',
            target: channelId,
            message: message
        });
        
        if (!sentMessage || !sentMessage.messageId) {
            console.error('ClawGuard: Failed to send approval message');
            return false;
        }
        
        // Add reaction prompts
        await context.message({
            action: 'react',
            messageId: sentMessage.messageId,
            emoji: '✅'
        });
        
        await context.message({
            action: 'react',
            messageId: sentMessage.messageId,
            emoji: '❌'
        });
        
        // Wait for reaction with timeout
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            // Poll for reactions
            const reactions = await context.message({
                action: 'reactions',
                messageId: sentMessage.messageId
            });
            
            if (reactions) {
                // Check for approval (✅)
                const approved = reactions.find(r => r.emoji === '✅' && r.users.length > 0);
                if (approved) {
                    return true;
                }
                
                // Check for denial (❌)
                const denied = reactions.find(r => r.emoji === '❌' && r.users.length > 0);
                if (denied) {
                    return false;
                }
            }
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Timeout
        await context.message({
            action: 'send',
            target: channelId,
            message: '⏱️ Approval request timed out. Denying action for safety.'
        });
        
        return false;
        
    } catch (error) {
        console.error(`ClawGuard approval error: ${error.message}`);
        return false; // Deny on error
    }
}

/**
 * Before tool call hook
 */
export async function before_tool_call(toolCall, context) {
    const config = loadConfig();
    const detector = getDetector();
    
    // Extract what to check
    const command = extractCommand(toolCall);
    const urls = extractUrls(toolCall);
    
    // Nothing to check
    if (!command && urls.length === 0) {
        return { allow: true };
    }
    
    // Check command if present
    if (command) {
        const result = await detector.checkCommand(command);
        
        if (result.exitCode === EXIT_CODE.BLOCK) {
            // BLOCKED - prevent execution
            console.log(`🛡️ ClawGuard BLOCKED: ${result.message}`);
            if (result.primaryThreat) {
                console.log(`   Threat: ${result.primaryThreat.name} (${result.primaryThreat.id})`);
            }
            return { 
                block: true,
                reason: `Security threat detected: ${result.primaryThreat?.name || 'Unknown threat'}`
            };
        }
        
        if (result.exitCode === EXIT_CODE.WARN) {
            // WARNING - request approval if Discord enabled
            if (config.discord.enabled && config.discord.channelId) {
                console.log(`⚠️ ClawGuard WARNING: Requesting Discord approval...`);
                
                const approvalMessage = formatApprovalMessage(command, 'command', result.primaryThreat);
                const approved = await requestDiscordApproval(
                    approvalMessage,
                    config.discord.channelId,
                    config.discord.timeout || 60000,
                    context
                );
                
                if (!approved) {
                    console.log(`🛡️ ClawGuard: Discord approval denied/timeout`);
                    return {
                        block: true,
                        reason: 'User denied or approval timeout'
                    };
                }
                
                console.log(`✅ ClawGuard: Discord approval granted`);
                return { allow: true };
            } else {
                // No Discord - allow with warning (can be tightened)
                console.log(`⚠️ ClawGuard WARNING: ${result.message}`);
                console.log(`   Discord approval not configured, allowing...`);
                return { allow: true };
            }
        }
    }
    
    // Check URLs if present
    for (const url of urls) {
        const result = await detector.checkUrl(url);
        
        if (result.exitCode === EXIT_CODE.BLOCK) {
            console.log(`🛡️ ClawGuard BLOCKED URL: ${result.message}`);
            if (result.primaryThreat) {
                console.log(`   Threat: ${result.primaryThreat.name} (${result.primaryThreat.id})`);
            }
            return {
                block: true,
                reason: `Malicious URL detected: ${result.primaryThreat?.name || 'Unknown threat'}`
            };
        }
        
        if (result.exitCode === EXIT_CODE.WARN) {
            // WARNING - request approval if Discord enabled
            if (config.discord.enabled && config.discord.channelId) {
                console.log(`⚠️ ClawGuard WARNING: Requesting Discord approval for URL...`);
                
                const approvalMessage = formatApprovalMessage(url, 'url', result.primaryThreat);
                const approved = await requestDiscordApproval(
                    approvalMessage,
                    config.discord.channelId,
                    config.discord.timeout || 60000,
                    context
                );
                
                if (!approved) {
                    console.log(`🛡️ ClawGuard: Discord approval denied/timeout`);
                    return {
                        block: true,
                        reason: 'User denied or approval timeout'
                    };
                }
                
                console.log(`✅ ClawGuard: Discord approval granted`);
                return { allow: true };
            } else {
                console.log(`⚠️ ClawGuard WARNING: ${result.message}`);
                console.log(`   Discord approval not configured, allowing...`);
                return { allow: true };
            }
        }
    }
    
    // All checks passed
    return { allow: true };
}

/**
 * Plugin initialization
 */
export function init(context) {
    console.log('🛡️ ClawGuard security plugin loaded');
    
    const config = loadConfig();
    
    if (config.discord.enabled && config.discord.channelId) {
        console.log(`   Discord approval enabled (channel: ${config.discord.channelId})`);
    } else {
        console.log('   Discord approval disabled (warnings will be logged but allowed)');
    }
    
    if (config.audit.enabled) {
        console.log('   Audit trail enabled');
    }
}

export default {
    metadata,
    init,
    before_tool_call
};
