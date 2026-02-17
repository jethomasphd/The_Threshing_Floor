/**
 * Claude API integration for AI-powered analysis.
 * Uses the Cloudflare Pages Function proxy to avoid CORS issues.
 */

const ClaudeClient = {
  PROXY_URL: '/api/claude',

  /**
   * Get the stored API key from localStorage.
   */
  getKey() {
    return localStorage.getItem('thresh_claude_key') || '';
  },

  /**
   * Save API key to localStorage.
   */
  saveKey(key) {
    if (key) {
      localStorage.setItem('thresh_claude_key', key.trim());
    } else {
      localStorage.removeItem('thresh_claude_key');
    }
  },

  /**
   * Check if an API key is configured.
   */
  hasKey() {
    return !!this.getKey();
  },

  /**
   * Run analysis on collected posts.
   * @param {Array} posts - Array of post objects
   * @param {string} analysisType - 'themes'|'sentiment'|'summary'|'questions'|'custom'
   * @param {string} customPrompt - Custom prompt (only used when analysisType is 'custom')
   * @returns {Promise<string>} - Claude's analysis text
   */
  async analyze(posts, analysisType, customPrompt = '') {
    const apiKey = this.getKey();
    if (!apiKey) {
      throw new Error('No Anthropic API key configured. Please add your key in Settings.');
    }

    // Prepare the data summary for Claude
    const dataSummary = this._prepareDataSummary(posts);
    const prompt = this._buildPrompt(analysisType, customPrompt, dataSummary);

    const response = await fetch(this.PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        system: 'You are a research analyst helping with social media data analysis for public health research and journalism. Provide clear, structured analysis. Use plain language. Be specific with examples from the data when possible.',
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.type === 'authentication_error') {
        throw new Error('Invalid API key. Please check your Anthropic API key.');
      }
      throw new Error(data.error || 'Claude API request failed');
    }

    // Extract text from Claude's response
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
    // Limit to prevent exceeding token limits
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
    const apiKey = this.getKey();
    if (!apiKey) {
      throw new Error('No Anthropic API key configured. Please add your key in Settings.');
    }

    const { posts, config, timestamp, wordFreq, stats, question, audience, context } = params;

    const dataSummary = this._prepareDataSummary(posts);

    const audienceFraming = {
      academic: 'Write in formal academic style suitable for a thesis, journal submission, or IRB documentation. Cite limitations rigorously. Use hedged language where appropriate (e.g., "the data suggest" rather than "the data prove"). Include specific recommendations for future research.',
      journalism: 'Write in clear, accessible prose suitable for a newsroom briefing or story pitch. Lead with the most newsworthy findings. Translate statistics into plain language. Note what would need further reporting before publication.',
      advocacy: 'Write for a policy brief or community report. Emphasize practical implications and actionable findings. Use clear, non-technical language. Frame the discussion around what the findings mean for affected communities.',
      general: 'Write in clear, engaging prose for a general audience. Explain methodology in plain terms. Focus on the most interesting and surprising findings. Keep the tone curious and exploratory.',
    };

    const wordFreqSection = wordFreq && wordFreq.length > 0
      ? `\n\nWORD FREQUENCY (top 20):\n${wordFreq.map(([w, c], i) => `  ${i + 1}. "${w}" (${c} occurrences)`).join('\n')}`
      : '';

    const systemPrompt = `You are a research methodologist and academic writer producing a structured research report. Your reports follow the Introduction / Methods / Results / Discussion format. You ground all claims in the data provided. You are transparent about limitations. You write for the specified audience. You produce Markdown output.`;

    const userPrompt = `Generate a complete research report based on the following data collection and analysis.

RESEARCH QUESTION: ${question}

AUDIENCE: ${audience}
${audienceFraming[audience] || audienceFraming.general}

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

Write the report in Markdown with these sections:

# [Report Title]

## Introduction
Frame the research question in context. Explain why this data source and community are relevant. ${context ? 'Incorporate the researcher\'s stated context.' : ''}

## Methods
Document exactly how the data was collected: the tool (The Threshing Floor), the subreddit(s), sort method, time filter, keyword filter, post limit, whether comments were included, and the date of collection. Note that the data was collected from Reddit's public JSON endpoints without authentication. This section should be precise enough for replication.

## Results
Present the findings. Start with descriptive statistics (post count, score distribution, comment engagement, date range). Present the word frequency analysis. Then analyze the content of the posts: themes, patterns, notable observations, and any surprising findings. Use specific examples from the data (quote post titles or content where relevant).

## Discussion
Interpret the results in light of the research question. What do the findings suggest? What are the limitations of this data? (Sample size, point-in-time snapshot, selection bias from sort method, Reddit demographics, etc.) What would strengthen these findings? Suggest next steps.

## Provenance
Include a brief provenance statement documenting the tool, method, and collection parameters for anyone who wants to replicate or audit this work.

IMPORTANT: The report should be substantive (1500-2500 words). Ground every claim in the actual data provided. Do not invent data points. If the data is insufficient to answer the research question fully, say so explicitly.`;

    const response = await fetch(this.PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.type === 'authentication_error') {
        throw new Error('Invalid API key. Please check your Anthropic API key.');
      }
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
