import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateBody,
  HelperText,
  HelperTextItem,
  Spinner,
  Timestamp,
  Title,
} from '@patternfly/react-core';
import { DownloadIcon } from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';

interface Artifact {
  name: string;
  size: number;
  modifiedAt: string;
}

interface ArtifactListing {
  mirrorDestination: string | null;
  artifacts: Artifact[];
}

interface OperationArtifactsProps {
  operationId: string;
  formatFileSize: (bytes?: number) => string;
}

/**
 * Lists the files in a successful operation's mirror destination. Downloads use plain
 * anchors so the browser streams them to disk (and can resume) instead of buffering
 * multi-GB archives in memory through axios.
 */
const OperationArtifacts: React.FC<OperationArtifactsProps> = ({ operationId, formatFileSize }) => {
  const [listing, setListing] = useState<ArtifactListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError(null);

    axios.get<ArtifactListing>(`/api/operations/${encodeURIComponent(operationId)}/artifacts`)
      .then(res => {
        if (!cancelled) setListing(res.data);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Error fetching artifacts:', err);
        const message = axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : 'Failed to load artifacts';
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [operationId]);

  return (
    <div className="pf-v6-u-mt-md">
      <Title headingLevel="h4" className="pf-v6-u-mb-sm">
        <DownloadIcon className="pf-v6-u-mr-sm" /> Artifacts
      </Title>

      {error && (
        <Alert variant="danger" isInline title="Could not load artifacts">
          {error}
        </Alert>
      )}

      {!error && !listing && <Spinner size="md" aria-label="Loading artifacts" />}

      {listing && (
        <>
          {listing.mirrorDestination && (
            <HelperText className="pf-v6-u-mb-sm">
              <HelperTextItem>
                Files currently in <code>{listing.mirrorDestination}</code>. This folder may also contain
                archives from other operations that used the same destination.
              </HelperTextItem>
            </HelperText>
          )}

          {listing.artifacts.length === 0 ? (
            <EmptyState variant="xs">
              <EmptyStateBody>No artifacts found in the mirror destination.</EmptyStateBody>
            </EmptyState>
          ) : (
            <Table aria-label="Operation artifacts" variant="compact" borders={false}>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Size</Th>
                  <Th>Modified</Th>
                  <Th screenReaderText="Download" />
                </Tr>
              </Thead>
              <Tbody>
                {listing.artifacts.map(artifact => (
                  <Tr key={artifact.name}>
                    <Td dataLabel="Name">{artifact.name}</Td>
                    <Td dataLabel="Size">{formatFileSize(artifact.size)}</Td>
                    <Td dataLabel="Modified">
                      <Timestamp date={new Date(artifact.modifiedAt)} tooltip={{ variant: 'default' }} />
                    </Td>
                    <Td dataLabel="Download">
                      <Button
                        variant="link"
                        isInline
                        component="a"
                        icon={<DownloadIcon />}
                        href={`/api/operations/${encodeURIComponent(operationId)}/artifacts/${encodeURIComponent(artifact.name)}`}
                        download={artifact.name}
                        aria-label={`Download ${artifact.name}`}
                      >
                        Download
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
};

export default OperationArtifacts;
