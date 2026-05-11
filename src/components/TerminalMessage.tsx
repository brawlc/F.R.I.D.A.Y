import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Message } from '../types';

interface TerminalMessageProps {
  message: Message;
}

export const TerminalMessage: React.FC<TerminalMessageProps> = ({ message }) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const isFriday = message.role === 'friday';
  const isSystem = message.role === 'system';
  const isUser = message.role === 'user';

  useEffect(() => {
    if (isUser || isSystem || !message.isStreaming) {
      setDisplayedContent(message.content);
      return;
    }
    
    // For streaming messages, we just display what's there
    setDisplayedContent(message.content);
  }, [message.content, isUser, isSystem, message.isStreaming]);

  const getPrefix = () => {
    if (isUser) return <span className="text-terminal-accent mr-2">C:\Users\BOSS&gt;</span>;
    if (isFriday) return <span className="text-terminal-green mr-2">[FRIDAY]</span>;
    if (isSystem) return <span className="text-yellow-500 mr-2">[SYSTEM]</span>;
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="font-mono text-sm mb-4 last:mb-0 whitespace-pre-wrap flex flex-col"
    >
      <div className="flex items-start">
        {getPrefix()}
        <div className={isFriday ? 'text-terminal-text' : isUser ? 'text-white font-medium' : 'text-terminal-text opacity-80 italic'}>
          {displayedContent}
          {message.isStreaming && <span className="terminal-cursor" />}
        </div>
      </div>
      <div className="text-[10px] text-terminal-border mt-1 opacity-50 uppercase">
        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
    </motion.div>
  );
};
