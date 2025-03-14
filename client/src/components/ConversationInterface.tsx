import React, { useState, useEffect, useRef } from 'react';
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/solid';
import { io, Socket } from 'socket.io-client';

// Get the server URL from environment variable or use localhost as fallback
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:8000';
console.log('Using server URL:', SERVER_URL);

// Determine if we should use secure WebSockets based on the URL
const useSecureWebsocket = SERVER_URL.startsWith('https');

const ConversationInterface: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Test the connection to the server
    console.log(`Testing connection to ${SERVER_URL}/test-cors`);
    fetch(`${SERVER_URL}/test-cors`)
      .then(response => response.json())
      .then(data => {
        console.log('Server connection test successful:', data);
      })
      .catch(error => {
        console.error('Server connection test failed:', error);
      });

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Add a function to handle connection errors and reconnection
  const handleSocketError = (err: any) => {
    console.error('Socket connection error:', err);
    setError(`Connection error: ${err.message || 'Unknown error'}`);
    
    // Attempt to reconnect after a delay
    setTimeout(() => {
      if (socketRef.current) {
        console.log('Attempting to reconnect...');
        socketRef.current.connect();
      }
    }, 3000);
  };

  const startConversation = async () => {
    try {
      setIsLoading(true);
      setError(null);

      console.log(`Initializing Socket.IO connection to ${SERVER_URL}`);
      console.log(`Using secure WebSocket: ${useSecureWebsocket}`);
      
      // Initialize Socket.IO connection with explicit configuration
      socketRef.current = io(SERVER_URL, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 5000,
        withCredentials: false, // Change to false for cross-domain requests to Render
        autoConnect: true,
        path: '/socket.io',
        secure: useSecureWebsocket
      });

      console.log('Socket.IO instance created:', socketRef.current);

      // Handle socket events
      socketRef.current.on('connect', () => {
        console.log('Connected to server with ID:', socketRef.current?.id);
        setIsLoading(false);
        setError(null);
      });

      socketRef.current.on('connect_error', (err) => {
        console.error('Socket connect_error:', err);
        handleSocketError(err);
      });

      socketRef.current.on('connect_timeout', () => {
        console.error('Socket connect_timeout');
        handleSocketError(new Error('Connection timeout'));
      });

      socketRef.current.on('connection_established', (data) => {
        console.log('Connection established with data:', data);
      });

      socketRef.current.on('conversation_started', (data) => {
        if (data.status === 'success') {
          setIsActive(true);
          startAudioStream();
        }
      });

      socketRef.current.on('audio_response', (audioData) => {
        playAudioResponse(audioData);
      });

      socketRef.current.on('error', (data) => {
        setError(data.message);
        stopConversation();
      });

      socketRef.current.on('disconnect', (reason) => {
        console.log('Disconnected from server. Reason:', reason);
        setError(`Disconnected from server: ${reason}`);
        setIsActive(false);
      });

      // Start the conversation
      socketRef.current.emit('start_conversation');
    } catch (err) {
      setError('Error connecting to server');
      console.error('Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const startAudioStream = async () => {
    try {
      // Get microphone access
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();

      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      const processor = audioContextRef.current.createScriptProcessor(1024, 1, 1);

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (e) => {
        if (socketRef.current && socketRef.current.connected) {
          const audioData = e.inputBuffer.getChannelData(0);
          // Convert Float32Array to regular array for better compatibility
          const audioDataArray = Array.from(audioData);
          socketRef.current.emit('audio_data', audioDataArray);
        }
      };
    } catch (err) {
      setError('Error accessing microphone');
      console.error('Microphone error:', err);
      stopConversation();
    }
  };

  const playAudioResponse = (audioData: any) => {
    if (!audioContextRef.current) return;
    
    try {
      // Handle different types of audio data
      let audioBuffer: ArrayBuffer;
      
      if (audioData instanceof ArrayBuffer) {
        audioBuffer = audioData;
      } else if (audioData instanceof Uint8Array) {
        // Create a new ArrayBuffer and copy the data
        audioBuffer = audioData.buffer.slice(0) as ArrayBuffer;
      } else if (Array.isArray(audioData)) {
        // Convert array to Float32Array
        const float32Array = new Float32Array(audioData);
        audioBuffer = float32Array.buffer as ArrayBuffer;
      } else {
        console.error('Unsupported audio data format:', typeof audioData);
        return;
      }
      
      audioContextRef.current.decodeAudioData(audioBuffer, (decodedBuffer) => {
        const source = audioContextRef.current!.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(audioContextRef.current!.destination);
        source.start(0);
      }, (err) => {
        console.error('Error decoding audio data:', err);
      });
    } catch (err) {
      console.error('Error playing audio response:', err);
    }
  };

  const stopConversation = () => {
    if (socketRef.current) {
      socketRef.current.emit('end_conversation');
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsActive(false);
  };

  return (
    <div className="mt-10">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="px-6 py-8">
          <div className="flex items-center justify-center mb-6">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {isActive ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
              {error}
            </div>
          )}

          <button
            onClick={isActive ? stopConversation : startConversation}
            disabled={isLoading}
            className={`w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-white ${
              isActive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            } focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isActive ? 'focus:ring-red-500' : 'focus:ring-indigo-500'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <>
                {isActive ? 'Stop Conversation' : 'Start Conversation'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConversationInterface; 