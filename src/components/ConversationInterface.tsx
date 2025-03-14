import React, { useState, useEffect } from 'react';
import { AudioConfigParams } from '@vocode/client';

const ConversationInterface: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);

  const startConversation = async () => {
    try {
      // Create WebSocket connection to your Replit backend
      const ws = new WebSocket('wss://your-replit-url.here/conversation');
      setWebSocket(ws);

      // Create audio context and processor
      const audioContext = new AudioContext();
      const audioConfig: AudioConfigParams = {
        samplingRate: audioContext.sampleRate,
        audioContext,
        volumeThreshold: -30,
      };

      // Set up audio processing
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(1024, 1, 1);

          source.connect(processor);
          processor.connect(audioContext.destination);

          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              ws.send(inputData);
            }
          };

          // Handle incoming audio from the server
          ws.onmessage = (event) => {
            const audio = new Audio(URL.createObjectURL(event.data));
            setAudioElement(audio);
            audio.play();
          };

          setIsActive(true);
        });

    } catch (error) {
      console.error('Error starting conversation:', error);
      setIsActive(false);
    }
  };

  const endConversation = () => {
    if (webSocket) {
      webSocket.close();
      setWebSocket(null);
    }
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
    }
    setIsActive(false);
  };

  useEffect(() => {
    return () => {
      if (webSocket) {
        webSocket.close();
      }
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, [webSocket, audioElement]);

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Vocode Conversation</h2>
          <div className="mb-6">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium" 
                  style={{ 
                    backgroundColor: isActive ? '#86efac' : '#fca5a5',
                    color: '#1f2937'
                  }}>
              {isActive ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          
          <button
            onClick={isActive ? endConversation : startConversation}
            className={`inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white ${
              isActive 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-indigo-600 hover:bg-indigo-700'
            } focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isActive ? 'focus:ring-red-500' : 'focus:ring-indigo-500'
            }`}
          >
            {isActive ? 'Stop Conversation' : 'Start Conversation'}
          </button>
        </div>

        <div className="mt-8">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Instructions</h3>
            <p className="text-sm text-gray-600">
              1. Click "Start Conversation" to begin<br/>
              2. Allow microphone access when prompted<br/>
              3. Start speaking - the AI will respond through your speakers<br/>
              4. Click "Stop Conversation" when finished
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationInterface; 