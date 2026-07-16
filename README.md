<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally or deploy it to GitHub Pages.

View your app in AI Studio: https://ai.studio/apps/c2879105-5b31-43b4-b28d-049cad6553a3

---

## 🚀 How to Enable GitHub Pages

The project contains a pre-configured GitHub Actions workflow (`.github/workflows/deploy.yml`) to build and deploy your app. However, **GitHub Pages is not enabled by default** when you push or import code to GitHub.

To make it run on GitHub:

1. **Go to your GitHub Repository** on the web.
2. Click on the **Settings** tab at the top.
3. In the left sidebar, scroll down to the **"Code and automation"** section and click on **Pages**.
4. Under **Build and deployment** > **Source**, change the selection from **"Deploy from a branch"** to **"GitHub Actions"**.
5. Go to the **Actions** tab of your repository to watch the deployment run. Once complete, it will provide you with the live website URL!

---

## 💻 Run Locally

**Prerequisites:** Node.js (version 18 or higher)

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Set your Gemini API key:**
   Create a `.env.local` file in the root directory and add:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
3. **Run the app locally:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 in your browser to view it.
