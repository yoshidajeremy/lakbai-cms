import React from 'react';
import FileManager from './file-manager/FileManager';

export default function DatasetCMS() {
  return (
    <div className="content-section">
      <div className="section-header">
        <div>
          <h2 className="title">Files</h2>
          <p className="muted">Manage files</p>
        </div>
      </div>

      {/* File manager for lakbai-cms/public */}
      <div style={{ marginTop: 12 }}>
        <FileManager root="public" />
      </div>
    </div>
  );
}