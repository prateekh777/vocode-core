# Vocode Voice API Server

This is the backend server for the Vocode Voice Chat application. It handles WebSocket connections for real-time audio streaming and processing.

## Local Development

1. Create a virtual environment:
   ```
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Create a `.env` file with your API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id
   ```

4. Run the server:
   ```
   python main.py
   ```

## Deployment

### Railway

1. Create a new project on [Railway](https://railway.app/)
2. Connect your GitHub repository
3. Add the following environment variables:
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`
4. Deploy the application

### Render

1. Create a new Web Service on [Render](https://render.com/)
2. Connect your GitHub repository
3. Set the build command: `pip install -r requirements.txt`
4. Set the start command: `python main.py`
5. Add the environment variables:
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`
6. Deploy the application

### Heroku

1. Install the Heroku CLI
2. Login to Heroku: `heroku login`
3. Create a new Heroku app: `heroku create your-app-name`
4. Set environment variables:
   ```
   heroku config:set OPENAI_API_KEY=your_openai_api_key
   heroku config:set ELEVENLABS_API_KEY=your_elevenlabs_api_key
   heroku config:set ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id
   ```
5. Deploy the application: `git push heroku main`

## After Deployment

Once deployed, update the client application's `.env.production` file with your deployed server URL:

```
REACT_APP_SERVER_URL=https://your-deployed-server-url
```

Then build and deploy the client application. 