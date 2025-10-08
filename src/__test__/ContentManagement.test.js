import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContentManagement from './ContentManagement';

// Mock dependencies
jest.mock('./firebase', () => ({
  db: {},
  auth: { currentUser: { email: 'test@lakbai.com', uid: 'testuid' } },
  storage: {},
}));
jest.mock('./cloudinary', () => ({
  CloudinaryContext: ({ children }) => <div>{children}</div>,
  Image: (props) => <img {...props} alt="cloudinary" />,
}));
jest.mock('./editprofile-cms', () => () => <div>EditProfileCMS</div>);
jest.mock('./viewprofile-cms', () => () => <div>ViewProfileCMS</div>);
jest.mock('./adduser-cms', () => () => <div>AddUserCMS</div>);
jest.mock('./adddestination-cms', () => () => <div>DestinationForm</div>);
jest.mock('./addfromcsv-cms', () => () => <div>AddFromCsvCMS</div>);
jest.mock('./reportdetails-cms', () => () => <div>ReportDetailModal</div>);
jest.mock('./takeaction-cms', () => () => <div>TakeActionModal</div>);
jest.mock('./auditlogs-cms', () => () => <div>AuditLogsCMS</div>);
jest.mock('./images-cms', () => () => <div>ImagesCMS</div>);
jest.mock('./notfound-cms', () => ({ text }) => <div>{text}</div>);
jest.mock('./publishAllDrafts', () => ({
  publishAllDrafts: jest.fn().mockResolvedValue(1),
}));
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
  doc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  addDoc: jest.fn().mockResolvedValue({ id: 'newid' }),
  deleteDoc: jest.fn(),
  getCountFromServer: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
  onSnapshot: jest.fn(() => jest.fn()),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  serverTimestamp: jest.fn(),
  collectionGroup: jest.fn(),
  documentId: jest.fn(),
  getDoc: jest.fn().mockResolvedValue({ exists: () => false }),
  startAfter: jest.fn(),
}));

describe('ContentManagement', () => {
  it('renders dashboard and sidebar', async () => {
    render(<ContentManagement />);
    expect(screen.getByText(/LakbAI/i)).toBeInTheDocument();
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Content Management System/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Destinations/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Users/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Reports/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Images/i)).toBeInTheDocument();
  });

  it('switches to Destinations tab', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Destinations/i));
    expect(await screen.findByText(/Manage destinations content/i)).toBeInTheDocument();
    expect(screen.getByText(/Publish All/i)).toBeInTheDocument();
    expect(screen.getByText(/\+ Add from CSV/i)).toBeInTheDocument();
    expect(screen.getByText(/\+ Add New destination/i)).toBeInTheDocument();
  });

  it('switches to Users tab', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Users/i));
    expect(await screen.findByText(/User Management/i)).toBeInTheDocument();
    expect(screen.getByText(/\+ Add New User/i)).toBeInTheDocument();
  });

  it('switches to Reports tab', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Reports/i));
    expect(await screen.findByText(/Content Reports/i)).toBeInTheDocument();
    expect(screen.getByText(/Review and moderate reported community content/i)).toBeInTheDocument();
  });

  it('switches to Audit Logs tab', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Audit Logs/i));
    expect(await screen.findByText(/AuditLogsCMS/i)).toBeInTheDocument();
  });

  it('switches to Images tab', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Images/i));
    expect(await screen.findByText(/ImagesCMS/i)).toBeInTheDocument();
  });

  it('shows sign out modal', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Sign Out/i));
    expect(await screen.findByText(/Confirm Sign Out/i)).toBeInTheDocument();
    expect(screen.getByText(/Yes, Sign Out/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancel/i)).toBeInTheDocument();
  });

  it('renders NotFoundCMS when no destinations', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Destinations/i));
    expect(await screen.findByText(/Destination not found/i)).toBeInTheDocument();
  });

  it('renders NotFoundCMS when no users', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Users/i));
    expect(await screen.findByText(/No users found/i)).toBeInTheDocument();
  });

  it('renders NotFoundCMS when no reports', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Reports/i));
    expect(await screen.findByText(/No reports found/i)).toBeInTheDocument();
  });

  it('renders NotFoundCMS when no images', async () => {
    render(<ContentManagement />);
    fireEvent.click(screen.getByText(/Images/i));
    expect(await screen.findByText(/ImagesCMS/i)).toBeInTheDocument();
  });
});