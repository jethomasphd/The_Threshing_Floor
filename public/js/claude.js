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
