/**
 * Claude API integration for AI-powered analysis.
 *
 * All AI requests are proxied through the managed thresh-proxy Cloudflare Worker
 * at api.the-threshing-floor.com. The API key is stored server-side as an
 * encrypted Cloudflare secret. Users never need their own key.
 */

const ClaudeClient = {
  // The managed thresh-proxy Cloudflare Worker
  MANAGED_PROXY_URL: 'https://api.the-threshing-floor.com',

  /**
   * AI features are always available via the managed proxy.
   */
  isAvailable() {
    return true;
  },

  /**
   * Build the request config for the managed proxy.
   */
  _getRequestConfig(messages, system) {
    return {
      url: this.MANAGED_PROXY_URL,
      body: { messages, system },
    };
  },

  /**
   * Run analysis on collected posts.
   * @param {Array} posts - Array of post objects
   * @param {string} analysisType - 'themes'|'sentiment'|'summary'|'questions'|'custom'
   * @param {string} customPrompt - Custom prompt (only used when analysisType is 'custom')
   * @returns {Promise<string>} - Claude's analysis text
   */
  async analyze(posts, analysisType, customPrompt = '') {
    const dataSummary = this._prepareDataSummary(posts);
    const prompt = this._buildPrompt(analysisType, customPrompt, dataSummary);

    const config = this._getRequestConfig(
      [{ role: 'user', content: prompt }],
      'You are a research analyst helping with social media data analysis for public health research and journalism. Provide clear, structured analysis. Use plain language. Be specific with examples from the data when possible.'
    );

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Claude API request failed');
    }

    if (data.content && data.content.length > 0) {
      return data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
    }

    throw new Error('No response content from Claude');
  },

  /**
   * Prepare a condensed data summary for Claude.
   */
  _prepareDataSummary(posts) {
    const sample = posts.slice(0, 50);
    const lines = sample.map((p, i) => {
      const date = new Date(p.created_utc * 1000).toISOString().slice(0, 10);
      const text = p.selftext ? p.selftext.slice(0, 300) : '';
      return `[${i + 1}] (score: ${p.score}, comments: ${p.num_comments}, date: ${date})\nTitle: ${p.title}\n${text ? 'Body: ' + text + (p.selftext.length > 300 ? '...' : '') : '(link post)'}`;
    });

    return `DATASET: ${posts.length} posts from r/${posts[0]?.subreddit || 'unknown'}\n\n` + lines.join('\n\n');
  },

  /**
   * Generate a full research report (Intro/Methods/Results/Discussion).
   * @param {Object} params - { posts, config, timestamp, wordFreq, stats, question, audience, context }
   * @returns {Promise<string>} - The full report in Markdown
   */
  async generateReport(params) {
    const { posts, config, timestamp, wordFreq, stats, question, audience, context } = params;

    const dataSummary = this._prepareDataSummary(posts);

    const wordFreqSection = wordFreq && wordFreq.length > 0
      ? `\n\nWORD FREQUENCY (top 20):\n${wordFreq.map(([w, c], i) => `  ${i + 1}. "${w}" (${c} occurrences)`).join('\n')}`
      : '';

    // Each audience gets a different system prompt and document structure
    const audienceConfigs = {
      academic: {
        system: 'You are a research methodologist producing a structured IMRaD research report (Introduction, Methods, Results, and Discussion). You write in formal academic style. You ground all claims in the data provided. You are transparent about limitations. You use hedged language (e.g., "the data suggest" rather than "the data prove"). You produce Markdown output.',
        structure: `Write the report in Markdown with these sections:

# [Report Title]

## Introduction
Frame the research question in context. Explain why this data source and community are relevant. ${context ? 'Incorporate the researcher\'s stated context.' : ''} Establish the significance of this inquiry within the relevant literature or field.

## Methods
Document exactly how the data was collected: the tool (The Threshing Floor), the subreddit(s), sort method, time filter, keyword filter, post limit, whether comments were included, and the date of collection. Note that the data was collected from Reddit's public JSON endpoints without authentication. This section should be precise enough for replication.

## Results
Present the findings. Start with descriptive statistics (post count, score distribution, comment engagement, date range). Present the word frequency analysis. Then analyze the content of the posts: themes, patterns, notable observations, and any surprising findings. Use specific examples from the data (quote post titles or content where relevant).

## Discussion
Interpret the results in light of the research question. What do the findings suggest? What are the limitations of this data? (Sample size, point-in-time snapshot, selection bias from sort method, Reddit demographics, etc.) What would strengthen these findings? Include specific recommendations for future research.

## Provenance
Include a brief provenance statement documenting the tool, method, and collection parameters for anyone who wants to replicate or audit this work.

IMPORTANT: The report should be substantive (1500-2500 words). Cite limitations rigorously. Use hedged language throughout. Ground every claim in the actual data. Do not invent data points. If the data is insufficient to answer the research question fully, say so explicitly.`,
      },

      journalism: {
        system: 'You are a veteran investigative journalist writing a data-informed column or feature article. You write in clear, compelling prose that tells a story. You lead with what matters most. You translate data into human terms. You attribute carefully and note what remains unverified. You produce Markdown output.',
        structure: `Write the piece as a journalist would — a data-driven column or feature article. Use Markdown formatting with these sections:

# [Compelling Headline]

## The Lede
Open with the single most striking or newsworthy finding from the data. Make the reader care in two sentences. A specific detail, a surprising number, a quote from a post that captures something larger.

## What the Data Shows
Walk through the key findings as a narrative. Don't just list statistics — tell the story they reveal. Use specific post titles or quotes as evidence. Weave in the numbers (post count, engagement patterns, word frequency) as supporting details, not as the lead. Organize around 2-3 key themes or story threads.

## What People Are Saying
Highlight the most revealing, representative, or surprising voices from the data. Quote directly from post titles and content. Let the community speak for itself. Note patterns in tone, urgency, or sentiment.

## What This Means
Interpret the findings. What story is this data telling? What would an editor want to know? What questions remain unanswered? What would need further reporting before publication?

## How We Got This Data
Brief methodology note: the tool used, subreddit(s) collected, time period, number of posts, and any limitations a reader should know about (Reddit demographics, sampling bias, point-in-time snapshot). Written for transparency, not academic rigor.

IMPORTANT: Write 1500-2500 words. Lead with what matters most. Use active voice. Short paragraphs. Translate every statistic into plain language. Ground every claim in the actual data. Do not invent quotes or data points.`,
      },

      advocacy: {
        system: 'You are a community strategist preparing a briefing document for a town hall, city council meeting, or advocacy campaign. You write in clear, action-oriented language. You emphasize what the data means for real people and what should be done about it. You are honest about limitations but focused on actionable implications. You produce Markdown output.',
        structure: `Write the report as a **Town Hall Brief** — a document a community organizer, campaign manager, or elected official could hand to stakeholders before a meeting. Use Markdown formatting with these sections:

# [Issue-Focused Title]

## The Situation
In 2-3 paragraphs, summarize what the data reveals about this community's concerns. Write for someone who has five minutes to get up to speed before walking into a meeting. Lead with the most urgent or actionable finding.

## Key Findings
Present 3-5 bullet-pointed findings, each with a clear heading and 1-2 sentences of explanation. Use specific numbers and examples from the data. These should be the talking points someone could bring to a podium.

## What People Are Telling Us
Highlight the most representative voices from the data. Quote directly from post titles and content. Organize by theme. This section should make the reader feel like they've listened to the community.

## By the Numbers
A brief statistical snapshot: how many posts, the date range, engagement levels, and the top words people are using. Presented as a quick-reference sidebar, not a methods section.

## Recommended Actions
Based on the data, suggest 3-5 concrete next steps. What should be brought up at the meeting? What needs further investigation? What can be done immediately? Be specific and practical.

## Data Source & Limitations
Brief note on where this data came from, how it was collected, and what it does and doesn't represent. Acknowledge Reddit's demographic skew and the snapshot nature of the data. Written for accountability, not academic formality.

IMPORTANT: Write 1200-2000 words. Use clear, non-technical language throughout. Frame everything around what the findings mean for affected communities and what should happen next. Ground every claim in the actual data. Do not invent data points.`,
      },

      general: {
        system: 'You are a thoughtful essayist writing an op-ed or explainer piece for a general audience. You write with curiosity and clarity. You make data accessible without dumbing it down. You have a point of view but ground it in evidence. You produce Markdown output.',
        structure: `Write the piece as a clear, engaging op-ed or explainer — the kind of article you'd read in a magazine or smart newsletter. Use Markdown formatting with these sections:

# [Thought-Provoking Title]

## The Hook
Open with something that makes the reader lean in — a surprising finding, a vivid detail from the data, or a question that the data answers in an unexpected way. 2-3 paragraphs max.

## What I Found
Walk through the key findings as a narrative of discovery. What patterns emerged? What surprised you? What confirmed your expectations and what didn't? Use specific examples from the posts — quote titles, reference content. Weave in the statistics naturally.

## The Bigger Picture
Step back and interpret. What does this data suggest about the broader topic? What are people really saying when you read between the lines? Connect the findings to the research question and any context the reader needs.

## The Caveats
Be honest about what this data can and can't tell us. Reddit isn't representative of everyone. This is a snapshot, not a census. The sort method and time filter shape what you see. Say this clearly but don't let it undermine the real insights.

## Where This Goes From Here
Close with what the findings point toward. More questions to ask? Actions to consider? A shift in perspective? End on something the reader will remember.

## About This Data
Brief note on collection method, tool used, subreddit(s), time period, and post count. One short paragraph — enough for credibility without belaboring the point.

IMPORTANT: Write 1200-2000 words. Be curious, not dry. Use "I" voice if it helps (the researcher's perspective). Short paragraphs. Ground every claim in the actual data. Do not invent data points.`,
      },
    };

    const audienceConfig = audienceConfigs[audience] || audienceConfigs.general;

    const userPrompt = `Generate a complete report based on the following data collection and analysis.

RESEARCH QUESTION: ${question}

AUDIENCE: ${audience}

${context ? `RESEARCHER'S CONTEXT: ${context}` : ''}

COLLECTION METADATA:
  Subreddit(s): r/${config.subreddit}
  Sort method: ${config.sort}
  Time filter: ${config.timeFilter}
  Max posts requested: ${config.limit}
  Keyword filter: ${config.keyword || '(none)'}
  Comments collected: ${config.includeComments ? 'yes' : 'no'}
  Collection date (UTC): ${timestamp}

SUMMARY STATISTICS:
  Posts collected: ${stats.postCount}
  Average score: ${stats.avgScore}
  Average comments: ${stats.avgComments}
  Date range: ${stats.dateRange}
${wordFreqSection}

${dataSummary}

${audienceConfig.structure}`;

    const reqConfig = this._getRequestConfig(
      [{ role: 'user', content: userPrompt }],
      audienceConfig.system
    );

    const response = await fetch(reqConfig.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqConfig.body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Claude API request failed');
    }

    if (data.content && data.content.length > 0) {
      return data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
    }

    throw new Error('No response content from Claude');
  },

  /**
   * Build the analysis prompt based on type.
   */
  _buildPrompt(type, customPrompt, dataSummary) {
    const prompts = {
      themes: `Analyze the following Reddit posts and identify the key themes and topics being discussed. Group related posts together and explain each theme with examples.\n\n${dataSummary}`,

      sentiment: `Analyze the sentiment of the following Reddit posts. Identify the overall tone (positive, negative, neutral, mixed), notable emotional patterns, and any shifts in sentiment. Provide specific examples.\n\n${dataSummary}`,

      summary: `Provide a comprehensive summary of the following Reddit discussion. What are the main points being made? What do people agree or disagree about? What stands out?\n\n${dataSummary}`,

      questions: `Extract and categorize the main questions people are asking in the following Reddit posts. What are they seeking help with? What information gaps exist? What concerns are they raising?\n\n${dataSummary}`,

      custom: `${customPrompt}\n\nHere is the data to analyze:\n\n${dataSummary}`,
    };

    return prompts[type] || prompts.themes;
  },
};
