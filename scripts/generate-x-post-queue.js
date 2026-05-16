#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const queuePath = path.join(projectRoot, 'marketing', 'x-post-queue.json');

const themes = [
  { name: 'speed', title: '⚡ Speed & Simplicity', count: 4 },
  { name: 'safety', title: '🔒 Safety & Isolation', count: 4 },
  { name: 'open-source', title: '🌍 Open Source', count: 4 },
  { name: 'developer', title: '👨‍💻 Developer Focus', count: 4 },
  { name: 'flexibility', title: '🔌 Flexibility', count: 4 },
  { name: 'community', title: '👥 Community', count: 4 },
  { name: 'features', title: '✨ Features & Benefits', count: 2 }
];

const ctas = [
  {
    short: 'Try demo',
    text: 'Try it now: https://webagent.aratech.ae',
    link: 'https://webagent.aratech.ae'
  },
  {
    short: 'Star GitHub',
    text: 'Star on GitHub: https://github.com/nikola66/web-agent',
    link: 'https://github.com/nikola66/web-agent'
  },
  {
    short: 'Fork it',
    text: 'Fork it: https://github.com/nikola66/web-agent/fork',
    link: 'https://github.com/nikola66/web-agent'
  },
  {
    short: 'Feedback',
    text: 'Share feedback: https://github.com/nikola66/web-agent/issues',
    link: 'https://github.com/nikola66/web-agent'
  },
  {
    short: 'Share it',
    text: 'Share with friends',
    link: 'https://webagent.aratech.ae'
  },
  {
    short: 'Learn more',
    text: 'Learn more: https://webagent.aratech.ae',
    link: 'https://webagent.aratech.ae'
  }
];

const hashtagSets = [
  ['#WebAgent', '#AI', '#OpenSource'],
  ['#AI', '#Agents', '#Open Source'],
  ['#Browser', '#Agent', '#MIT'],
  ['#DeveloperTools', '#AI', '#OpenSource'],
  ['#LocalAI', '#Ollama', '#OpenSource'],
  ['#Privacy', '#Safety', '#AI'],
  ['#BuildInPublic', '#OpenSource', '#Community']
];

function generateStartDate() {
  // Start from today
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMessageForTheme(themeId, index) {
  const templates = {
    speed: [
      'Web Agent starts in ~10 seconds. No VPS, no VM, no install nightmare.',
      'Fast, simple, browser-based AI agent workspace.',
      'Zero setup time. All you need is a browser.',
      'Instant startup. No configuration required.'
    ],
    safety: [
      'Browser isolation means your machine stays safe.',
      'No risky access. No permissions needed.',
      'Isolated experiments. Resettable state. No machine access.',
      'Agenting without the risk to your personal machine.'
    ],
    'open-source': [
      'MIT licensed. Fully open source. Community-driven.',
      'Open source means you control the code.',
      'Fork it, modify it, make it yours.',
      'Free and open. No proprietary baggage.'
    ],
    developer: [
      'For developers building AI agents.',
      'Perfect playground for agentic workflows.',
      'Developer-friendly. Hackable. Extensible.',
      'Built by developers, for developers.'
    ],
    flexibility: [
      'Connect any provider. OpenAI, Anthropic, Ollama, Azure.',
      'Bring your own model. Full control.',
      'Use any AI provider you want.',
      'Flexible. Provider-agnostic. Your choice.'
    ],
    community: [
      'Join the Web Agent community.',
      'Build in public. Share your workflows.',
      'Together we\'re building better AI tools.',
      'Community-first approach to development.'
    ],
    features: [
      'Local storage. Browser-native. No database needed.',
      'Shareable workflows and experiments.',
      'Reset and retry without side effects.',
      'All the tools you need for AI agenting.'
    ]
  };

  return (templates[themeId] || templates.features)[
    index % (templates[themeId] || templates.features).length
  ];
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateQueue() {
  const queue = [];
  let date = generateStartDate();
  let dayCount = 1;
  let messageIndex = {};

  // Initialize message indices for each theme
  themes.forEach((theme) => {
    messageIndex[theme.name] = 0;
  });

  for (let i = 0; i < 30; i++) {
    // Pick a theme (distribute somewhat evenly)
    const theme = themes[i % themes.length];

    const message = getMessageForTheme(theme.name, messageIndex[theme.name] || 0);
    messageIndex[theme.name] = (messageIndex[theme.name] || 0) + 1;

    const cta = getRandomElement(ctas);
    const hashtags = getRandomElement(hashtagSets);

    let postText = `${message}\n\n${cta.text}`;

    // Add hashtags occasionally
    if (Math.random() > 0.4) {
      postText += `\n\n${hashtags.join(' ')}`;
    }

    // Keep under 280 characters
    if (postText.length > 280) {
      // Remove hashtags if too long
      postText = `${message}\n\n${cta.text}`;
    }

    const post = {
      id: `day-${dayCount}`,
      date: formatDate(date),
      theme: theme.name,
      post_text: postText,
      hashtags: hashtags,
      suggested_tags: [],
      github_link: 'https://github.com/nikola66/web-agent',
      demo_link: 'https://webagent.aratech.ae',
      visual_idea: `Visual for day ${dayCount}: ${theme.title}`,
      status: i < 6 ? 'approved' : 'draft', // First week approved, rest draft
      posted_at: null,
      x_post_id: null,
      error: null
    };

    queue.push(post);

    // Move to next day
    date.setDate(date.getDate() + 1);
    dayCount++;
  }

  return queue;
}

function main() {
  console.log('🎬 Generating 30-day Web Agent X content queue...');

  const queue = generateQueue();

  const content = { queue };
  fs.writeFileSync(queuePath, JSON.stringify(content, null, 2));

  console.log(`✅ Generated ${queue.length} posts`);
  console.log(`📁 Saved to: ${queuePath}`);
  console.log('');
  console.log('📊 Content distribution:');
  themes.forEach((theme) => {
    const count = queue.filter((p) => p.theme === theme.name).length;
    if (count > 0) {
      console.log(`   ${theme.title}: ${count} posts`);
    }
  });

  console.log('');
  console.log('📋 Status distribution:');
  const approved = queue.filter((p) => p.status === 'approved').length;
  const draft = queue.filter((p) => p.status === 'draft').length;
  console.log(`   ✅ Approved: ${approved} posts (ready to post)`);
  console.log(`   📝 Draft: ${draft} posts (review and approve before posting)`);

  console.log('');
  console.log('💡 Next steps:');
  console.log('   1. Review marketing/x-post-queue.json');
  console.log('   2. Change "status": "draft" to "status": "approved" for posts you want to use');
  console.log('   3. Run: npm run marketing:dry-run (to test without posting)');
  console.log('   4. Run: LIVE_POSTING=true npm run marketing:post (to post to X)');
}

main();
