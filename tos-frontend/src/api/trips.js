import { get, post, put, del } from './client.js';

/**
 * Trip Planner API — Phase 9a.
 * All endpoints require JWT auth (hub_trips is user-scoped).
 */

// ── Trips ──────────────────────────────────────────────────────────────────

export const listTrips       = ()          => get('/v1/trips');
export const createTrip      = (payload)   => post('/v1/trips', payload);
export const getTrip         = (id)        => get(`/v1/trips/${id}`);
export const updateTrip      = (id, data)  => put(`/v1/trips/${id}`, data);
export const deleteTrip      = (id)        => del(`/v1/trips/${id}`);

// ── Legs ───────────────────────────────────────────────────────────────────

export const addLeg          = (tripId, payload)        => post(`/v1/trips/${tripId}/legs`, payload);
export const updateLeg       = (tripId, legId, data)    => put(`/v1/trips/${tripId}/legs/${legId}`, data);
export const deleteLeg       = (tripId, legId)          => del(`/v1/trips/${tripId}/legs/${legId}`);
export const reorderLegs     = (tripId, legId, payload) => post(`/v1/trips/${tripId}/legs/${legId}/reorder`, payload);

// ── Activities ─────────────────────────────────────────────────────────────

export const addActivity     = (tripId, legId, payload)        => post(`/v1/trips/${tripId}/legs/${legId}/activities`, payload);
export const updateActivity  = (tripId, legId, actId, data)    => put(`/v1/trips/${tripId}/legs/${legId}/activities/${actId}`, data);
export const deleteActivity  = (tripId, legId, actId)          => del(`/v1/trips/${tripId}/legs/${legId}/activities/${actId}`);

// ── Documents ──────────────────────────────────────────────────────────────

export const addDocument     = (tripId, payload) => post(`/v1/trips/${tripId}/documents`, payload);
export const deleteDocument  = (tripId, docId)   => del(`/v1/trips/${tripId}/documents/${docId}`);

// ── Collaborators ──────────────────────────────────────────────────────────

export const addCollaborator    = (tripId, payload) => post(`/v1/trips/${tripId}/collaborators`, payload);
export const removeCollaborator = (tripId, userId)  => del(`/v1/trips/${tripId}/collaborators/${userId}`);
