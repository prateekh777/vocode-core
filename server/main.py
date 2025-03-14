from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from vocode.streaming.streaming_conversation import StreamingConversation
from vocode.streaming.agent import ChatGPTAgent
from vocode.streaming.synthesizer.eleven_labs_synthesizer import ElevenLabsSynthesizer
from vocode.streaming.transcriber.base_transcriber import BaseTranscriber
import os
import logging
from dotenv import load_dotenv
import openai
import asyncio
import nest_asyncio
import numpy as np
import datetime
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Print debug information
logger.info("Python version: %s", sys.version)
logger.info("Current working directory: %s", os.getcwd())
logger.info("Directory contents: %s", os.listdir())

# Apply nest_asyncio to allow nested event loops
nest_asyncio.apply()

# Load environment variables
load_dotenv()
logger.info("Environment variables loaded")
logger.info("Available environment variables: %s", list(os.environ.keys()))

# Configure OpenAI client
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    logger.error("OPENAI_API_KEY not found in environment variables")
    raise ValueError("OPENAI_API_KEY is required")

# Set the API key for the OpenAI module
openai.api_key = openai_api_key
logger.info("OpenAI client initialized")

# Initialize Flask app
app = Flask(__name__)

# Configure CORS to allow requests from your React app
# Define allowed origins
allowed_origins = ["http://localhost:3000", "http://192.168.178.85:3000", "https://vocode-core-kdqv.onrender.com"]

# Add CORS middleware with dynamic origin handling
@app.after_request
def after_request(response):
    origin = request.headers.get('Origin')
    if origin and (origin in allowed_origins or '*' in allowed_origins):
        response.headers.add('Access-Control-Allow-Origin', origin)
    else:
        response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Configure CORS with Flask-CORS
CORS(app, resources={
    r"/*": {
        "origins": allowed_origins,
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})
logger.info("CORS configured")

# Configure SocketIO with CORS settings
socketio = SocketIO(
    app, 
    cors_allowed_origins=allowed_origins,
    ping_timeout=5,     # Match client timeout
    ping_interval=10,   # Reduce ping interval
    async_mode='threading',  # Add threading mode for better performance
    engineio_logger=True,    # Enable engine.io logging for debugging
    logger=True,             # Enable Socket.IO logging
    always_connect=True,     # Always accept connections
    max_http_buffer_size=1e8, # Increase buffer size for audio data
    path='/socket.io',        # Explicitly set the Socket.IO path
    allow_upgrades=True,      # Allow transport upgrades
    transports=['websocket']  # Force WebSocket transport only
)
logger.info("SocketIO initialized with WebSocket transport only")

# Store active conversations
conversations = {}

# Add a function to log all events for debugging
def log_event(event, *args):
    logger.info(f"Event received: {event}, Args: {args}")

# Register the event logger
socketio.on_event('*', log_event)

@app.route('/', methods=['GET'])
def index():
    logger.info("Health check endpoint called")
    return jsonify({"status": "Vocode API Server is running", "version": "1.0.0"})

@app.route('/test-cors', methods=['GET', 'OPTIONS'])
def test_cors():
    if request.method == 'OPTIONS':
        # Preflight request response
        response = jsonify({'status': 'ok'})
        # Don't add CORS headers here, they'll be added by the after_request function
        return response
    return jsonify({"status": "CORS test successful", "timestamp": str(datetime.datetime.now())})

@app.route('/api/health', methods=['GET', 'OPTIONS'])
def health_check():
    if request.method == 'OPTIONS':
        # Preflight request response
        response = jsonify({'status': 'ok'})
        # Don't add CORS headers here, they'll be added by the after_request function
        return response
    return jsonify({"status": "healthy"})

@socketio.on('connect')
def handle_connect():
    logger.info(f'Client connected: {request.sid}')
    logger.info(f'Connection details: Transport={request.environ.get("wsgi.websocket_version", "unknown")}, Headers={dict(request.headers)}')
    emit('connection_established', {'status': 'connected', 'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    reason = request.args.get('reason', 'unknown')
    logger.info(f'Client disconnected: {request.sid}, Reason: {reason}')
    if request.sid in conversations:
        try:
            conversations[request.sid].terminate()
            del conversations[request.sid]
            logger.info(f'Conversation terminated for client: {request.sid}')
        except Exception as e:
            logger.error(f'Error terminating conversation: {str(e)}')

@socketio.on('start_conversation')
def handle_start_conversation():
    try:
        logger.info(f'Starting conversation for client: {request.sid}')
        
        # Set up event loop for this thread
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # If there's no event loop in the current thread, create one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            logger.info("Created new event loop for thread")
        
        # Initialize conversation components
        agent = ChatGPTAgent(
            agent_config={
                "initial_message": "Hello! How can I help you today?",
                "model_name": "gpt-3.5-turbo",
                "openai_api_key": openai_api_key,
                "end_conversation_on_goodbye": True
            }
        )
        logger.info("ChatGPT agent initialized")
        
        # Check for ElevenLabs API key
        elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
        elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID")
        
        if not elevenlabs_api_key or not elevenlabs_voice_id:
            logger.error("ElevenLabs API key or voice ID not found")
            emit('error', {'message': 'ElevenLabs configuration missing'})
            return
            
        synthesizer = ElevenLabsSynthesizer(
            synthesizer_config={
                "api_key": elevenlabs_api_key,
                "voice_id": elevenlabs_voice_id
            }
        )
        logger.info("ElevenLabs synthesizer initialized")
        
        # Using BaseTranscriber with OpenAI configuration
        transcriber = BaseTranscriber(
            transcriber_config={
                "model": "whisper-1",
                "provider": "openai",
                "openai_api_key": openai_api_key
            }
        )
        logger.info("Transcriber initialized")
        
        # Initialize conversation
        conversation = StreamingConversation(
            agent=agent,
            synthesizer=synthesizer,
            transcriber=transcriber
        )
        logger.info("Streaming conversation initialized")
        
        # Store conversation with socket ID as key
        conversations[request.sid] = conversation
        
        emit('conversation_started', {'status': 'success'})
        logger.info(f'Conversation started successfully for client: {request.sid}')
    except Exception as e:
        logger.error(f'Error starting conversation: {str(e)}', exc_info=True)
        emit('error', {'message': str(e)})

@socketio.on('audio_data')
def handle_audio_data(data):
    try:
        # Log data type and size for debugging
        data_type = type(data).__name__
        data_size = len(data) if hasattr(data, '__len__') else 'unknown'
        logger.debug(f'Received audio data: Type={data_type}, Size={data_size}')
        
        conversation = conversations.get(request.sid)
        if conversation:
            # Convert data to the format expected by the conversation
            # If data is a list, convert it to a numpy array
            if isinstance(data, list):
                data = np.array(data, dtype=np.float32)
                logger.debug(f'Converted list to numpy array: Shape={data.shape}, dtype={data.dtype}')
            
            # Process audio data through the conversation
            response = conversation.process_audio(data)
            if response:
                logger.debug(f'Audio response generated: Type={type(response).__name__}, Size={len(response) if hasattr(response, "__len__") else "unknown"}')
                emit('audio_response', response)
            else:
                logger.debug('No audio response generated')
        else:
            logger.warning(f'No active conversation found for client: {request.sid}')
            emit('error', {'message': 'No active conversation found'})
    except Exception as e:
        logger.error(f'Error processing audio: {str(e)}', exc_info=True)
        emit('error', {'message': str(e)})

@socketio.on('end_conversation')
def handle_end_conversation():
    try:
        conversation = conversations.get(request.sid)
        if conversation:
            conversation.terminate()
            del conversations[request.sid]
            emit('conversation_ended', {'status': 'success'})
            logger.info(f'Conversation ended for client: {request.sid}')
        else:
            logger.warning(f'No active conversation found to end for client: {request.sid}')
    except Exception as e:
        logger.error(f'Error ending conversation: {str(e)}', exc_info=True)
        emit('error', {'message': str(e)})

if __name__ == '__main__':
    # Get port from environment variable or use default
    port = int(os.environ.get('PORT', 8000))
    
    # In production, we should use 0.0.0.0 to bind to all interfaces
    host = os.environ.get('HOST', '0.0.0.0')
    
    logger.info(f"Starting server on host {host} and port {port}")
    logger.info(f"Current directory: {os.getcwd()}")
    logger.info(f"Available environment variables: {list(os.environ.keys())}")
    
    try:
        # Use debug=False in production
        socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)
    except Exception as e:
        logger.error(f"Error starting server: {str(e)}", exc_info=True)
        sys.exit(1)