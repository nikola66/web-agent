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
  accessToken: process.env.X_ACCESS_TOKEN,
  livePosting: true,
  requireApproval: false
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
    return null;
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

// Enhanced content with trending tags and mentions
function enhanceContent(post) {
  // Trendy hashtags pool (rotates based on date)
  const trendyHashtags = [
    '#BuildInPublic',
    '#OpenSource',
    '#AIAgents',
    '#DevTools',
    '#TechStartup',
    '#SoftwareDevelopment',
    '#JavaScript',
    '#WebDevelopment',
    '#AITools',
    '#FutureOfWork',
    '#NoCode',
    '#Innovation',
    '#StartupLife',
    '#DeveloperCommunity',
    '#GitHubStars'
  ];

  // Relevant people to tag (researchers, developers, AI folks)
  const relevantTags = [
    '@vxnuk',        // AI/agent enthusiast
    '@getdappai',    // AI developer
    '@svpino',       // AI expert
    '@andrewng',     // AI pioneer
    '@ylecun',       // AI researcher
    '@karpathy',     // AI/ML expert
    '@emollick',     // AI adoption
    '@hardmaru',     // AI research
  ];

  let enhancedText = post.post_text;

  // Add 2-3 trending hashtags if not already present
  const dayOfMonth = new Date().getDate();
  const selectedHashtags = [
    trendyHashtags[dayOfMonth % trendyHashtags.length],
    trendyHashtags[(dayOfMonth + 1) % trendyHashtags.length],
    trendyHashtags[(dayOfMonth + 2) % trendyHashtags.length]
  ].filter(tag => !enhancedText.includes(tag));

  // Occasionally tag someone relevant (1 in 3 chance)
  if (dayOfMonth % 3 === 0 && !enhancedText.includes('@')) {
    const selectedTag = relevantTags[dayOfMonth % relevantTags.length];
    if (enhancedText.length + selectedTag.length + 1 <= 280) {
      enhancedText = `${selectedTag} ${enhancedText}`;
    }
  }

  // Add selected hashtags if there's room
  const hashtagString = selectedHashtags.slice(0, 2).join(' ');
  if (enhancedText.length + hashtagString.length + 1 <= 280) {
    enhancedText = `${enhancedText}\n\n${hashtagString}`;
  }

  return enhancedText.trim();
}

async function main() {
  console.log('🤖 Intelligent Daily Web Agent Poster');
  console.log('═'.repeat(50));

  const today = getTodayDate();
  console.log(`📅 Date: ${today}`);
  console.log(`🌐 Cloud-based automated posting`);
  console.log('');

  // Load data
  let queue;
  let history;

  try {
    queue = loadQueue();
    if (!queue) {
      console.log('⏭️  No queue found. Skipping today.');
      process.exit(0);
    }
    history = loadHistory();
  } catch (error) {
    console.error('❌ Error loading data:', error.message);
    process.exit(1);
  }

  // Find today's post
  const todayPost = queue.find((item) => item.date === today);

  if (!todayPost) {
    console.log('⏭️  No post scheduled for today.');
    const nextPosts = queue
      .filter((p) => p.date > today && p.status !== 'posted')
      .slice(0, 3)
      .map((p) => `${p.date}`)
      .join(', ');
    if (nextPosts) console.log(`   Next posts: ${nextPosts}`);
    process.exit(0);
  }

  // Check if already posted
  if (todayPost.status === 'posted') {
    console.log('✅ Already posted today!');
    console.log(`   Posted at: ${todayPost.posted_at}`);
    process.exit(0);
  }

  // Enhance content with trending tags and mentions
  const enhancedText = enhanceContent(todayPost);

  console.log('📝 Post ID:', todayPost.id);
  console.log('🎯 Theme:', todayPost.theme);
  console.log('');
  console.log('📄 ENHANCED POST CONTENT:');
  console.log('─'.repeat(50));
  console.log(enhancedText);
  console.log('─'.repeat(50));
  console.log(`⚙️  Character count: ${enhancedText.length}/280`);

  if (enhancedText.length > 280) {
    console.error('❌ Post exceeds 280 characters after enhancement');
    process.exit(1);
  }

  console.log('');
  console.log('🚀 POSTING TO X...');

  if (!config.accessToken) {
    console.error('❌ Missing X API access token');
    process.exit(1);
  }

  const result = await postToX(enhancedText, config.accessToken);

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
    todayPost.enhanced_text = enhancedText;
    saveQueue(queue);

    // Update history
    history.push({
      id: todayPost.id,
      date: todayPost.date,
      post_id: result.post_id,
      posted_at: result.timestamp,
      text: enhancedText,
      url: result.url,
      theme: todayPost.theme
    });
    saveHistory(history);

    console.log('📊 Updated history');
    console.log('✨ Daily post complete!');
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

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
