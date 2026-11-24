# BR Rank Squad Control Panel — Web UI

This folder contains a responsive, static dashboard preview.

## Deploy as a static site on Render

1. In Render, choose **New + → Static Site**.
2. Connect `chsandeep829-bot/Ff-glory-bot`.
3. Select the repository's default branch.
4. Set the publish directory to `web`.
5. Leave the build command empty and deploy.

The dashboard is currently a frontend-only shell. It does not connect to the repository's Android-compiled Python modules and does not expose account-generation or gameplay automation actions. Add a separately reviewed, authorized backend before showing private records or enabling server-side operations.

## Local preview

Open `index.html` in a browser.
