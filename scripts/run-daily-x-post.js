#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { postToX } from './post-to-x.js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const queuePath = path.join(projectRoot, 'marketing', 'x-post-queue.json');
const historyPath = path.join(projectRoot, 'marketing', 'x-post-history.json');

// Load environment variables
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const config = {
  apiKey: process.env.X_API_KEY,
  apiSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  livePosting: process.env.LIVE_POSTING === 'true',
  requireApproval: process.env.REQUIRE_APPROVAL !== 'false',
  includeLinks: process.env.POST_INCLUDE_LINKS !== 'false'
};

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadQueue() {
  if (!fs.existsSync(queuePath)) {
    throw new Error(`Queue file not found: ${queuePath}`);
  }

  const content = fs.readFileSync(queuePath, 'utf8');
  const { queue } = JSON.parse(content);
  return queue;
}

function loadHistory() {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, 'utf8');
  const { history } = JSON.parse(content);
  return history || [];
}

function saveQueue(queue) {
  const content = { queue };
  fs.writeFileSync(queuePath, JSON.stringify(content, null, 2));
}

function saveHistory(history) {
  const content = { history };
  fs.writeFileSync(historyPath, JSON.stringify(content, null, 2));
}

function findTodayPost(queue) {
  const today = getTodayDate();
  return queue.find((item) => item.date === today);
}

function hasBeenPosted(postId, history) {
  return history.some((item) => item.id === postId);
}

async function main() {
  console.log('🐦 Web Agent X Posting Scheduler');
  console.log('═'.repeat(50));

  const today = getTodayDate();
  console.log(`📅 Date: ${today}`);
  console.log(`🔒 Live posting: ${config.livePosting ? 'YES' : 'NO (dry-run mode)'}`);
  console.log(`✅ Require approval: ${config.requireApproval ? 'YES' : 'NO'}`);
  console.log('');

  // Load data
  let queue;
  let history;

  try {
    queue = loadQueue();
    history = loadHistory();
  } catch (error) {
    console.error('❌ Error loading data:', error.message);
    process.exit(1);
  }

  // Find today's post
  const todayPost = findTodayPost(queue);

  if (!todayPost) {
    console.log('⏭️  No post scheduled for today.');
    console.log(`   Next posts: ${queue
      .filter((p) => p.date > today && p.status !== 'posted')
      .slice(0, 3)
      .map((p) => `${p.date}`)
      .join(', ')}`);
    process.exit(0);
  }

  console.log(`📝 Post ID: ${todayPost.id}`);
  console.log(`🎯 Theme: ${todayPost.theme}`);
  console.log(`📊 Status: ${todayPost.status}`);
  console.log('');

  // Check if already posted
  if (todayPost.status === 'posted') {
    console.log('✅ Already posted today!');
    console.log(`   Posted at: ${todayPost.posted_at}`);
    console.log(`   Post: https://twitter.com/i/web/status/${todayPost.x_post_id}`);
    process.exit(0);
  }

  // Check approval
  if (config.requireApproval && todayPost.status !== 'approved') {
    console.log('⏸️  Post is not approved. Skipping.');
    console.log(`   Status: ${todayPost.status}`);
    console.log(`   To approve: edit marketing/x-post-queue.json and set status to "approved"`);
    process.exit(0);
  }

  // Show post content
  console.log('📄 POST CONTENT:');
  console.log('─'.repeat(50));
  console.log(todayPost.post_text);
  console.log('─'.repeat(50));
  console.log(`\n⚙️  Character count: ${todayPost.post_text.length}/280`);

  if (todayPost.hashtags && todayPost.hashtags.length > 0) {
    console.log(`🏷️  Hashtags: ${todayPost.hashtags.join(', ')}`);
  }

  if (config.includeLinks) {
    console.log(`🔗 Links included: yes`);
  }

  console.log('');

  // Dry-run mode
  if (!config.livePosting) {
    console.log('🏃 DRY-RUN MODE: Post would be sent but is not actually sent.');
    console.log('   To post live, run with: LIVE_POSTING=true npm run marketing:post');
    process.exit(0);
  }

  // Live posting
  console.log('🚀 POSTING TO X...');

  // Validate credentials
  if (!config.accessToken) {
    console.error('❌ Missing X API access token');
    console.error('   Please check .env file and ensure X_ACCESS_TOKEN is set');
    process.exit(1);
  }

  const result = await postToX(
    todayPost.post_text,
    config.accessToken
  );

  if (result.success) {
    console.log('✅ Posted successfully!');
    console.log(`   Post ID: ${result.post_id}`);
    console.log(`   URL: ${result.url}`);
    console.log('');

    // Update queue
    todayPost.status = 'posted';
    todayPost.posted_at = new Date().toISOString();
    todayPost.x_post_id = result.post_id;
    todayPost.error = null;
    saveQueue(queue);

    // Update history
    history.push({
      id: todayPost.id,
      date: todayPost.date,
      post_id: result.post_id,
      posted_at: result.timestamp,
      text: todayPost.post_text,
      url: result.url
    });
    saveHistory(history);

    console.log('📊 Updated x-post-history.json');
    process.exit(0);
  } else {
    console.error('❌ Failed to post');
    console.error(`   Error: ${result.error}`);

    if (result.details) {
      console.error('   Details:', JSON.stringify(result.details, null, 2));
    }

    // Update queue with error
    todayPost.error = result.error;
    saveQueue(queue);

    console.log('');
    console.log('💡 Troubleshooting:');
    console.log('   - Check X API credentials in .env');
    console.log('   - Verify app has Read and Write permissions in X Developer Dashboard');
    console.log('   - Check post length (max 280 characters)');
    console.log('   - Check X API rate limits');
    console.log('   - Check for duplicate post within 24 hours');

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
