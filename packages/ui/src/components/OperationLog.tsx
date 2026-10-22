import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import {
  Banner,
  Button,
  MenuToggle,
  Select,
  SelectList,
  SelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Tooltip,
  type MenuToggleElement,
} from '@patternfly/react-core';
import {
  CompressIcon,
  DownloadIcon,
  ExpandIcon,
  ExternalLinkAltIcon,
  PauseIcon,
  PlayIcon,
} from '@patternfly/react-icons';
import { LogViewer, LogViewerSearch } from '@patternfly/react-log-viewer';

/** Same default as the console's pod logs: show the last 1,000 lines unless "Show full log" is on. */
const DEFAULT_BUFFER_SIZE = 1000;

interface OperationLogProps {
  log: string;
  /** Shown when there is no log output yet. */
  emptyText: string;
  height: number;
  /** True while the operation runs and new output can still arrive. */
  isStreaming: boolean;
  /** File name for Download, e.g. '<operation id>.log'. */
  downloadName: string;
}

const splitLines = (text: string): string[] => {
  const lines = text.split('\n');
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
};

/** Opens or saves text through a short-lived blob URL; the log is already in the browser. */
const withBlobUrl = (text: string, handle: (url: string) => void) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  handle(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * oc-mirror output in PatternFly's LogViewer with the controls of the console's pod logs:
 * pause/resume, show full log, wrap lines, search, raw view, download and fullscreen.
 * ANSI colors render as in pod logs.
 */
export default function OperationLog({ log, emptyText, height, isStreaming, downloadName }: OperationLogProps) {
  const toolbarId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [frozenLog, setFrozenLog] = useState('');
  const [showFullLog, setShowFullLog] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pausing only makes sense while output can still arrive.
  useEffect(() => {
    if (!isStreaming) setPaused(false);
  }, [isStreaming]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const pause = useCallback(() => {
    setFrozenLog(log);
    setPaused(true);
  }, [log]);

  const allLines = splitLines(paused ? frozenLog : log);
  const lines = showFullLog ? allLines : allLines.slice(-DEFAULT_BUFFER_SIZE);
  const linesBehind = paused ? splitLines(log).length - splitLines(frozenLog).length : 0;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  };

  // Menus must render inside the fullscreen element, or they open behind it.
  const appendTo = isFullscreen ? () => document.getElementById(toolbarId) ?? document.body : undefined;

  const toolbar = (
    <Toolbar id={toolbarId}>
      <ToolbarContent>
        <ToolbarGroup align={{ default: 'alignStart' }}>
          {isStreaming && (
            <ToolbarItem>
              <Tooltip content={paused ? 'Log stream paused' : 'Log streaming...'}>
                <Button
                  variant="plain"
                  aria-label={paused ? 'Resume log stream' : 'Pause log stream'}
                  icon={paused ? <PlayIcon /> : <PauseIcon />}
                  onClick={() => (paused ? setPaused(false) : pause())}
                />
              </Tooltip>
            </ToolbarItem>
          )}
          <ToolbarItem>
            <Select
              toggle={(toggleRef: Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setOptionsOpen(open => !open)}
                  isExpanded={optionsOpen}
                  isSettings
                >
                  Options
                </MenuToggle>
              )}
              onSelect={(_event, value) => {
                if (value === 'fullLog') setShowFullLog(on => !on);
                if (value === 'wrapLines') setWrapLines(on => !on);
              }}
              onOpenChange={setOptionsOpen}
              isOpen={optionsOpen}
              popperProps={{ appendTo }}
            >
              <SelectList>
                <Tooltip
                  content={`Select to view the entire log. Default view is the last ${DEFAULT_BUFFER_SIZE.toLocaleString()} lines.`}
                  position="right"
                >
                  <SelectOption value="fullLog" isSelected={showFullLog} hasCheckbox>
                    Show full log
                  </SelectOption>
                </Tooltip>
                <SelectOption value="wrapLines" isSelected={wrapLines} hasCheckbox>
                  Wrap lines
                </SelectOption>
              </SelectList>
            </Select>
          </ToolbarItem>
        </ToolbarGroup>
        <ToolbarGroup align={{ default: 'alignEnd' }}>
          <ToolbarItem>
            <LogViewerSearch
              placeholder="Search logs"
              minSearchChars={0}
              onFocus={() => {
                if (isStreaming && !paused) pause();
              }}
            />
          </ToolbarItem>
          <ToolbarGroup variant="action-group-plain">
            <ToolbarItem>
              <Tooltip content="View raw logs">
                <Button
                  variant="plain"
                  aria-label="View raw logs"
                  icon={<ExternalLinkAltIcon />}
                  onClick={() => withBlobUrl(log, url => window.open(url, '_blank'))}
                />
              </Tooltip>
            </ToolbarItem>
            <ToolbarItem>
              <Tooltip content="Download">
                <Button
                  variant="plain"
                  aria-label="Download"
                  icon={<DownloadIcon />}
                  onClick={() =>
                    withBlobUrl(log, url => {
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = downloadName;
                      link.click();
                    })
                  }
                />
              </Tooltip>
            </ToolbarItem>
            {document.fullscreenEnabled && (
              <ToolbarItem>
                <Tooltip content={isFullscreen ? 'Collapse' : 'Expand'}>
                  <Button
                    variant="plain"
                    aria-label={isFullscreen ? 'Collapse' : 'Expand'}
                    icon={isFullscreen ? <CompressIcon /> : <ExpandIcon />}
                    onClick={toggleFullscreen}
                  />
                </Tooltip>
              </ToolbarItem>
            )}
          </ToolbarGroup>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );

  return (
    <div
      ref={containerRef}
      style={isFullscreen ? { height: '100vh', padding: 'var(--pf-t--global--spacer--sm)' } : undefined}
    >
      <LogViewer
        data={lines.length > 0 ? lines.join('\n') : emptyText}
        height={isFullscreen ? '100%' : height}
        hasLineNumbers
        isTextWrapped={wrapLines}
        scrollToRow={paused ? undefined : lines.length}
        onScroll={({ scrollOffsetToBottom, scrollDirection, scrollUpdateWasRequested }) => {
          // Same as pod logs: scrolling up pauses the stream, scrolling to the bottom resumes it.
          if (!isStreaming || scrollUpdateWasRequested) return;
          if (scrollOffsetToBottom < 1) setPaused(false);
          else if (scrollDirection === 'backward' && !paused) pause();
        }}
        toolbar={toolbar}
        header={
          <Banner status={isStreaming ? undefined : 'info'}>
            {lines.length === 1 ? '1 line' : `${lines.length} lines`}
            {!isStreaming && lines.length > 0 && ' - Log stream ended.'}
          </Banner>
        }
        footer={
          paused && (
            <Button icon={<PlayIcon />} onClick={() => setPaused(false)} isBlock>
              {linesBehind > 0
                ? `Resume stream and show ${linesBehind} new line${linesBehind === 1 ? '' : 's'}`
                : 'Resume stream'}
            </Button>
          )
        }
      />
    </div>
  );
}
