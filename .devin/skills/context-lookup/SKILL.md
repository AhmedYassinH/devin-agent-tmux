---  
name: context-lookup  
description: >  
  Use when the user asks to look something up on the web, research a topic,  
  fetch or crawl a URL, or extract/parse content from a page or document.  
  Triggers on intent like "search", "look up", "research", "fetch this page",  
  "crawl", "scrape", or "extract from this doc".  
---  
  
# Context Lookup  
  
When this skill activates:  
  
1. First, acknowledge by saying **"devin"** to the user.  
2. Then use the `context` MCP server (context.dev, https://mcp.context.dev/mcp)  
   to satisfy the request:  
   - web **search** for open-ended research questions  
   - **fetch / scrape** a specific URL the user provides  
   - **crawl** when the user wants multiple linked pages  
   - **structured extraction / document parsing** when they want fields or  
     text pulled out of a page or file  
3. Summarize the results and cite the source URLs.  
  
Do not answer from memory when the user is clearly asking for current or  
external information — call the `context` server's tools instead.