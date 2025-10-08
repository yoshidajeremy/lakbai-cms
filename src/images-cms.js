import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import './Styles/contentManager.css';
import './Styles/images-cms.css';
import { FiCopy } from "react-icons/fi"; // Add this if using react-icons, or use your preferred icon
import destImages from './dest-images.json'; // Import for local use
import NotFoundCMS from './notfound-cms'; // Add this import at the top

const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'dcv3eqmde';

// API base can be configured using REACT_APP_API_BASE (e.g. https://lakbai-cms-server.onrender.com)
// If not set, defaults to relative paths so localhost proxy or same-origin will work.
const API_BASE = process.env.REACT_APP_API_BASE || '';
const apiUrl = (path) => {
    if (!path.startsWith('/')) path = '/' + path;
    if (API_BASE) return API_BASE.replace(/\/$/, '') + path;
    return path; // relative
};

const fs = window.require ? window.require('fs') : null; // For Electron/Node context

export default function ImagesCMS() {
    const [images, setImages] = useState([]);
    const [selectedImages, setSelectedImages] = useState([]);
    const [activeImage, setActiveImage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [openDetails, setOpenDetails] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadTotal, setUploadTotal] = useState(0);
    const [uploadDone, setUploadDone] = useState(0);

    // New state for delete confirmation and error
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        loadImages();
    }, []);

    const loadImages = async () => {
        setLoading(true);
        try {
        const response = await fetch(`${API_BASE}/api/cloudinary-images`);
        const data = await response.json();
        const list = data.resources || []; // ✅ fix for returned object shape
        setImages(
            list.map(img => ({
                    id: img.public_id,
                    url: img.secure_url,
                    publicId: img.public_id,
                    name: img.public_id.split('/').pop().replace(/_/g, ' ').replace('.jpg', ''),
                    createdBy: img.uploaded_by || 'Unknown',
                    createdAt: img.created_at
                }))
            );
        } catch (err) {
            console.error('Error loading images:', err);
        }
        setLoading(false);
    };

    const getPublicIdFromUrl = (url) => {
        try {
            // Extract everything after '/upload/' and before file extension
            const match = url.match(/\/upload\/([^\.]+)\./);
            return match ? match[1] : url;
        } catch (e) {
            return 'unknown';
        }
    };

    // Select all handler
    const handleSelectAll = () => {
        if (selectedImages.length === images.length) {
            setSelectedImages([]);
        } else {
            setSelectedImages(images.map(img => img.id));
        }
    };

    // Checkbox handler
    const handleImageSelect = (image) => {
        setSelectedImages(prev => 
            prev.includes(image.id)
                ? prev.filter(id => id !== image.id)
                : [...prev, image.id]
        );
    };

    // Copy single image URL handler
    const copyImageUrl = (url) => {
        navigator.clipboard.writeText(url).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 1800);
        });
    };

    const copySelectedUrls = () => {
        const urls = images
            .filter(img => selectedImages.includes(img.id))
            .map(img => img.url)
            .join('\n');
        if (urls) {
            navigator.clipboard.writeText(urls).then(() => {
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 1800);
            });
        }
    };

    const getCloudinaryUrl = (urlOrPublicId) => {
        // If it's already a full URL, return as is
        if (urlOrPublicId.startsWith('http')) return urlOrPublicId;

        // If it's a versioned path (v1234/filename.ext), prepend Cloudinary base URL
        if (/^v\d+\/[^\/]+\.\w+$/.test(urlOrPublicId)) {
            return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${urlOrPublicId}`;
        }

        // If it's just a public ID (no slash, no version), fallback to 'destinations' folder and .jpg
        if (!urlOrPublicId.includes('/')) {
            return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/destinations/${urlOrPublicId}.jpg`;
        }

        // Otherwise, fallback to placeholder
        return '/placeholder.jpg';
    };

    // Chunking logic
    const chunkSize = 3;
    const chunkedImages = [];
    for (let i = 0; i < images.length; i += chunkSize) {
        chunkedImages.push(images.slice(i, i + chunkSize));
    }

    // --- Upload Handler ---
    const handleUploadClick = () => {
        document.getElementById('cloudinary-upload-input').click();
    };

    // Modified for progress bar and count
    const handleFileChange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const fileArr = Array.from(files);
        setUploadTotal(fileArr.length);
        setUploadDone(0);
        setUploadProgress(0);

        for (let i = 0; i < fileArr.length; i++) {
            const file = fileArr[i];
            if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
                alert('Only JPG images are allowed.');
                continue;
            }
            // Check for duplicate name (case-insensitive, ignore .jpg)
            const newName = file.name.replace(/\.jpe?g$/i, '').trim().toLowerCase();
            const isDuplicate = images.some(img => img.name.trim().toLowerCase() === newName);
            if (isDuplicate) {
                setUploadError('Image with this name already exists.');
                setTimeout(() => setUploadError(''), 3000);
                continue;
            }
            setUploading(true);
            setUploadError('');
            try {
                // Upload to Cloudinary
                const formData = new FormData();
                formData.append('file', file);
                formData.append('upload_preset', process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'lakbai_uploads');
                const actualName = file.name.replace(/\.jpe?g$/i, '');
                formData.append('public_id', actualName);

                // Progress event
                let xhr = new XMLHttpRequest();
                xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setUploadProgress(Math.round((event.loaded / event.total) * 100));
                    }
                };
                const uploadPromise = new Promise((resolve, reject) => {
                    xhr.onload = () => {
                        if (xhr.status === 200) {
                            resolve(JSON.parse(xhr.responseText));
                        } else {
                            reject(new Error('Upload failed'));
                        }
                    };
                    xhr.onerror = () => reject(new Error('Upload failed'));
                });
                xhr.send(formData);
                const data = await uploadPromise;
                if (!data.secure_url) throw new Error('Upload failed');

                await addDoc(collection(db, 'photos'), {
                    name: actualName,
                    url: data.secure_url,
                    publicId: data.public_id,
                    createdBy: 'Admin',
                    createdAt: Date.now(),
                });

                // Also update dest-images.json if needed (see previous logic)
                if (fs) {
                    try {
                        const jsonPath = require('path').join(__dirname, './dest-images.json');
                        let current = [];
                        try {
                            current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                        } catch {}
                        const url = data.secure_url;
                        if (!current.some(img => img.url === url)) {
                            current.push({ name: actualName, url });
                            fs.writeFileSync(jsonPath, JSON.stringify(current, null, 2), 'utf8');
                        }
                    } catch (err) {
                        // Silent fail for browser context
                    }
                } else {
                    await fetch(apiUrl('/api/update-dest-image'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: actualName, url: data.secure_url })
                    });
                }

                // Write Audit Log to Firebase
                const auditLog = {
                    eventId: `${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    action: 'photo upload',
                    category: 'destination image',
                    target: `photo (${data.public_id})`,
                    request: `POST https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
                    outcome: data.secure_url ? 'SUCCESS' : 'failure',
                    user: {
                        name: 'Aclan Jeremy',
                        username: 'aclanjeremy432@gmail.com',
                        role: 'Admin',
                        userId: 'cuuEceXHEmOMa37xQeSTFbixeqt2',
                        session: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    },
                    source: {
                        device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
                        browser: navigator.userAgent,
                        os: navigator.userAgentData?.platform || navigator.platform,
                    },
                    securityFlags: 'None',
                    eventDetails: {
                        filename: file.name,
                        size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
                        location: data.public_id.split('/')[0] || 'unknown',
                    },
                    userAgent: navigator.userAgent,
                    dataChanges: {
                        filename: file.name,
                        size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
                        location: data.public_id.split('/')[0] || 'unknown',
                    },
                    createdAt: serverTimestamp(),
                };
                await addDoc(collection(db, 'auditLogs'), auditLog);

                setUploadDone(done => done + 1);
                setUploadProgress(0);
                await loadImages();
            } catch (err) {
                setUploadError('Image upload failed. Please try again.');
                console.error(err);
                setTimeout(() => setUploadError(''), 3000);
            }
        }
        setUploading(false);
        setUploadProgress(0);
        setUploadTotal(0);
        setUploadDone(0);
        e.target.value = '';
    };

    // Delete handler
    const handleDeleteImages = async () => {
        setDeleting(true);
        setDeleteError('');
        try {
            const toDelete = images.filter(img => selectedImages.includes(img.id));
            for (const img of toDelete) {
                // Delete from Cloudinary
                const publicId = img.publicId;
                if (publicId) {
                    // Call your backend endpoint to delete from Cloudinary
                    const res = await fetch(apiUrl('/api/cloudinary/delete'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ publicId })
                    });
                    if (!res.ok) throw new Error('Cloudinary delete failed');
                }
                // Delete from Firestore
                await deleteDoc(doc(db, 'photos', img.id));
                await addDoc(collection(db, 'auditLogs'), {
                    eventId: `${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    action: 'photo delete',
                    category: 'dest. image delete',
                    target: `photo (${img.publicId})`,
                    request: `DELETE ${apiUrl('/api/cloudinary/delete')}`,
                    outcome: 'SUCCESS',
                    user: 'Aclan Jeremy',
                    role: 'admin',
                    user: {
                        name: 'Aclan Jeremy',
                        username: 'aclanjeremy432@gmail.com',
                        role: 'admin',
                        userId: 'cuuEceXHEmOMa37xQeSTFbixeqt2',
                        session: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    },
                    source: {
                        device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
                        browser: navigator.userAgent,
                        os: navigator.userAgentData?.platform || navigator.platform,
                    },
                    securityFlags: 'None',
                    eventDetails: {
                        filename: img.name,
                        url: img.url,
                        publicId: img.publicId,
                    },
                    userAgent: navigator.userAgent,
                    dataChanges: {
                        deleted: true,
                        imageId: img.id,
                    },
                    createdAt: serverTimestamp(),
                });
                try {
                    if (fs) {
                        const jsonPath = require('path').join(__dirname, './dest-images.json');
                        let current = [];
                        try {
                            current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                        } catch {}
                        // Remove entry with matching name (case-insensitive, trimmed)
                        const updated = current.filter(
                            imgEntry => imgEntry.name?.trim().toLowerCase() !== img.name.trim().toLowerCase()
                        );
                        fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');
                    } else {
                        // Call backend API to remove from dest-images.json by name only
                        await fetch(apiUrl('/api/delete-dest-image'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: img.name })
                        });
                    }
                } catch (err) {
                    // Silent fail for browser context
                }
            }
            setImages(prev => prev.filter(img => !selectedImages.includes(img.id)));
            setSelectedImages([]);
            setDeleteConfirmOpen(false);
        } catch (err) {
            setDeleteError('Failed to delete image(s). Please try again.');
        }
        setDeleting(false);
    };

    // Helper: Parse CSV and map region to destination names
    function parseRegionCsv(csvText) {
        const lines = csvText.split('\n').filter(Boolean);
        const regionMap = {};
        for (const line of lines) {
            const [region, name] = line.split(',');
            if (region && name) {
                if (!regionMap[region.trim()]) regionMap[region.trim()] = [];
                regionMap[region.trim()].push(name.trim());
            }
        }
        return regionMap;
    }

    // Load region-destination mapping once
    const [regionMap, setRegionMap] = useState({});
    useEffect(() => {
        fetch('/src/region-destinations.csv')
            .then(res => res.text())
            .then(csv => setRegionMap(parseRegionCsv(csv)));
    }, []);

    // Filter images by region using CSV and dest-images.json
    const filteredImages = images.filter(img => {
        if (status === 'all') return true;
        // Find matching destination names for selected region
        const regionNames = regionMap[status] || [];
        // Check if image name matches any destination name in region
        return regionNames.some(destName =>
            img.name.trim().toLowerCase() === destName.trim().toLowerCase()
        );
    }).filter(img => img.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="content-section">
            <div className="section-header">
                <div>
                    <h2 className="title">Images</h2>
                    <p className="muted">Manage destination images</p>
                </div>
                <div className="images-cms-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Progress bar and counts */}
                    {uploading && (
                        <div style={{ display: 'flex', alignItems: 'center', minWidth: 220, marginRight: 8 }}>
                            {/* Horizontal progress bar */}
                            <div style={{
                                width: 120,
                                height: 8,
                                background: '#e5e7eb',
                                borderRadius: 6,
                                marginRight: 10,
                                overflow: 'hidden',
                                display: 'flex',
                                alignItems: 'center'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${uploadProgress}%`,
                                    background: '#2563eb',
                                    transition: 'width 0.3s'
                                }} />
                            </div>
                            <div style={{ fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
                                {uploadDone}/{uploadTotal} uploaded
                                {uploadTotal - uploadDone > 0 && (
                                    <span style={{ color: '#b91c1c', marginLeft: 8 }}>
                                        {uploadTotal - uploadDone} not uploaded
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                    <button 
                        className="btn-primary-cms"
                        onClick={handleUploadClick}
                        disabled={uploading}
                        style={{ minWidth: 120 }}
                    >
                        {uploading ? 'Uploading...' : 'Upload Image'}
                    </button>
                    <button
                        className="btn-secondary"
                        style={{ minWidth: 120 }}
                        onClick={handleSelectAll}
                    >
                        {selectedImages.length === images.length && images.length > 0 ? 'Unselect All' : 'Select All'}
                    </button>
                    <input
                        id="cloudinary-upload-input"
                        type="file"
                        accept=".jpg,.jpeg"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        multiple
                    />
                    {selectedImages.length === 1 && (
                        <button 
                            className="btn-danger"
                            onClick={() => setDeleteConfirmOpen(true)}
                        >
                            Delete
                        </button>
                    )}
                    {selectedImages.length > 1 && (
                        <button 
                            className="btn-danger"
                            onClick={() => setDeleteConfirmOpen(true)}
                        >
                            Delete All
                        </button>
                    )}
                    {selectedImages.length > 0 && (
                        <button 
                            className="btn-secondary"
                            onClick={copySelectedUrls}
                        >
                            Copy Selected URLs
                        </button>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirmOpen && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        zIndex: 2000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    onClick={e => { if (e.target === e.currentTarget) setDeleteConfirmOpen(false); }}
                >
                    <div
                        style={{
                            background: '#fff',
                            borderRadius: 12,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                            padding: 32,
                            minWidth: 340,
                            maxWidth: '90vw',
                            textAlign: 'center'
                        }}
                    >
                        <h3 style={{ marginBottom: 16 }}>
                            {selectedImages.length === 1 ? 'Delete Image' : 'Delete Images'}
                        </h3>
                        <div style={{ marginBottom: 18 }}>
                            Are you sure you want to delete {selectedImages.length === 1 ? 'this image' : 'these images'}?
                        </div>
                        {deleteError && (
                            <div style={{ color: '#b91c1c', marginBottom: 12 }}>{deleteError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                            <button
                                className="btn-danger"
                                style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
                                disabled={deleting}
                                onClick={handleDeleteImages}
                            >
                                {deleting ? 'Deleting...' : 'Yes'}
                            </button>
                            <button
                                className="btn-secondary"
                                style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Search Bar */}
            <div className="content-card" style={{ padding: 16, borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                <span className="search-icon" style={{ position: 'absolute', left: 14, top: 22, opacity: 0.6 }}>🔎</span>
                <input
                    className="form-input"
                    type="text"
                    style={{ width: '100%', paddingLeft: 40 }}
                    placeholder="Search images by name..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                </div>
                <select
                    className="images-cms-status-dropdown"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ width: 160 }}
                >
                    <option value="all">Region</option>
                    <option value="CAR">CAR - Cordillera Administrative Region</option>
                    <option value="CARAGA">CARAGA - Region XIII</option>
                    <option value="ILOCOS">Ilocos Region</option>
                    <option value="NCR">NCR - National Capital Region</option>
                    <option value="REGION_I">Region I - Ilocos Region</option>
                    <option value="REGION_IV_B">Region IV-B - MIMAROPA</option>
                    <option value="REGION_V">Region V - Bicol Region</option>
                    <option value="REGION_VI">Region VI - Western Visayas</option>
                    <option value="REGION_VII">Region VII - Central Visayas</option>
                    <option value="REGION_VIII">Region VIII - Eastern Visayas</option>
                    <option value="REGION_IX">Region IX - Zamboanga Peninsula</option>
                    <option value="REGION_X">Region X - Northern Mindanao</option>
                    <option value="REGION_XI">Region XI - Davao Region</option>
                    <option value="REGION_XII">Region XII - SOCCSKSARGEN</option>
                    <option value="REGION_XIII">Region XIII - CARAGA</option>
                    <option value="NCR">NCR - National Capital Region</option>
                    <option value="BARMM">BARMM - Bangsamoro Autonomous Region in Muslim Mindanao</option>
                </select>
            </div>

            <div className="images-cms-rows-container">
                <div className="images-cms-row-box">
                    <div className="images-cms-grid">
                        {loading ? (
                            <div style={{ gridColumn: '1/-1', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 }}>
                                <div className="loading-spinner" />
                                <div style={{ color: '#64748b', marginTop: 18, fontSize: 16 }}>Loading images...</div>
                            </div>
                        ) : (
                            (() => {
                                const filtered = images.filter(img => img.name.toLowerCase().includes(search.toLowerCase()));
                                if (filtered.length === 0) {
                                    return (
                                        <div style={{ gridColumn: '1/-1', width: '100%' }}>
                                            <NotFoundCMS text="Image not found" />
                                        </div>
                                    );
                                }
                                return filtered.map(image => (
                                    <div className={`image-card${selectedImages.includes(image.id) ? ' active' : ''}`} key={image.id}>
                                        <div className="image-card-content" style={{ position: 'relative' }}>
                                            {/* Checkbox top-left */}
                                            <input
                                                type="checkbox"
                                                className="images-cms-checkbox"
                                                checked={selectedImages.includes(image.id)}
                                                onChange={() => handleImageSelect(image)}
                                                style={{
                                                    position: 'absolute',
                                                    top: 10,
                                                    left: 10,
                                                    zIndex: 2,
                                                    width: 22,
                                                    height: 22
                                                }}
                                            />
                                            {/* Copy link icon top-right */}
                                            <button
                                                className="images-cms-copy-btn"
                                                title="Copy image URL"
                                                style={{
                                                    position: 'absolute',
                                                    top: 10,
                                                    right: 10,
                                                    background: '#fff',
                                                    border: '1px solid #e0e7ef',
                                                    borderRadius: 6,
                                                    padding: 4,
                                                    fontSize: 18,
                                                    cursor: 'pointer',
                                                    zIndex: 2,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                                onClick={() => copyImageUrl(image.url)}
                                            >
                                                {/* Use react-icons or fallback to emoji */}
                                                <FiCopy style={{ color: '#2563eb', fontSize: 18 }} />
                                            </button>
                                            <img src={image.url} alt={image.name} />
                                        </div>
                                        <div className="image-card-footer">
                                            {
                                                // Remove a trailing 6-character ID if separated by space, else show full name
                                                (() => {
                                                    const match = image.name.match(/^(.*)\s([a-zA-Z0-9]{6})$/);
                                                    return match ? match[1] : image.name;
                                                })()
                                            }
                                        </div>
                                        <div className="image-card-details">
                                            <div className="image-details">
                                                <div className="detail-row">
                                                    <span className="detail-label">Name:</span>
                                                    <span>{image.name}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Public ID:</span>
                                                    <span>{image.publicId}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Created By:</span>
                                                    <span>{image.createdBy}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Created At:</span>
                                                    <span>{new Date(image.createdAt).toLocaleDateString()}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">URL:</span>
                                                    <span className="url-text">{image.url}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ));
                            })()
                        )}
                    </div>
                </div>
            </div>

            {/* On-screen confirmation for copy */}
            {copySuccess && (
                <div
                    style={{
                        position: 'fixed',
                        top: 32,
                        right: 32,
                        background: '#22c55e',
                        color: '#fff',
                        padding: '12px 28px',
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 16,
                        boxShadow: '0 2px 12px rgba(34,197,94,0.12)',
                        zIndex: 3000,
                        transition: 'opacity 0.3s'
                    }}
                >
                    URLs copied!
                </div>
            )}

            {/* On-screen error for upload */}
            {uploadError && (
                <div
                    style={{
                        position: 'fixed',
                        top: 32,
                        right: 32,
                        background: '#ef4444',
                        color: '#fff',
                        padding: '12px 28px',
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 16,
                        boxShadow: '0 2px 12px rgba(239,68,68,0.12)',
                        zIndex: 3000,
                        transition: 'opacity 0.3s',
                        animation: 'fadeOut 0.5s ease-in-out 3s forwards'
                    }}
                >
                    {uploadError}
                </div>
            )}
        </div>
    );
}