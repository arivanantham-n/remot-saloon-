import React, { Component } from 'react';
import { useOfflineQuery } from './useOfflineQuery';
import { SkeletonCard } from './SkeletonCard';
import styles from './Skeleton.module.css';

/**
 * Enterprise React Error Boundary
 * Catches render-time crashes and presents a human-friendly fallback.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render failure:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.errorContainer} role="alert">
          <div className={styles.errorIcon}>⚠️</div>
          <h3 className={styles.errorTitle}>Something went wrong</h3>
          <p className={styles.errorText}>
            We encountered an unexpected display error. Your previous booking data remains safe.
          </p>
          <button className={styles.retryButton} onClick={this.handleReset}>
            <span>🔄</span> Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ServiceCatalogView — Resilient Data Fetching with Skeleton & Offline Mode
 */
export function ServiceCatalogView({ category = 'All', onSelectService }) {
  // Safe fetch function utilizing API
  const fetchServices = async ({ signal }) => {
    const url = `/api/services${category !== 'All' ? `?category=${category}` : ''}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.services || [];
  };

  const {
    data: services,
    isLoading,
    isRefreshing,
    isFromCache,
    cachedAt,
    error,
    isOnline,
    refetch
  } = useOfflineQuery(`services_${category}`, fetchServices, {
    timeoutMs: 5000,
    maxAgeMs: 12 * 60 * 60 * 1000 // 12h cache
  });

  return (
    <div className="service-catalog-container">
      {/* ─── Offline Mode Banner ─── */}
      {(isFromCache || !isOnline) && (
        <div className={styles.offlineBanner} role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className={styles.offlineBadge}>Offline Mode</span>
            <span>
              {!isOnline
                ? "You're currently offline. Displaying saved catalog data."
                : `Viewing cached data ${cachedAt ? `from ${new Date(cachedAt).toLocaleTimeString()}` : ''}.`}
            </span>
          </div>
          {isOnline && (
            <button
              onClick={refetch}
              disabled={isRefreshing}
              style={{
                background: 'transparent',
                border: '1px solid currentColor',
                color: 'inherit',
                borderRadius: '8px',
                padding: '0.25rem 0.6rem',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Sync Fresh'}
            </button>
          )}
        </div>
      )}

      {/* ─── Error State (Both Network & Cache Failed) ─── */}
      {error && !services && (
        <div className={styles.errorContainer} role="alert">
          <div className={styles.errorIcon}>📡</div>
          <h3 className={styles.errorTitle}>Unable to load services</h3>
          <p className={styles.errorText}>{error}</p>
          <button className={styles.retryButton} onClick={refetch}>
            <span>🔄</span> Retry Connection
          </button>
        </div>
      )}

      {/* ─── Services Grid (Layout Shift Free) ─── */}
      <div className="service-grid" style={{ minHeight: '380px' }}>
        {isLoading && !services ? (
          <SkeletonCard count={6} />
        ) : (
          services?.map((svc) => (
            <div
              key={svc._id}
              className="glass-card service-card fade-in visible"
              style={{ display: 'flex', flexDirection: 'column' }}
            >
              <div
                style={{
                  height: '180px',
                  borderRadius: 'var(--radius-md, 16px)',
                  overflow: 'hidden',
                  background: 'var(--primary-10)',
                  marginBottom: '1.25rem'
                }}
              >
                {svc.images?.[0] ? (
                  <img
                    src={svc.images[0]}
                    alt={svc.name}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2rem'
                    }}
                  >
                    ✨
                  </div>
                )}
              </div>

              <span className="badge badge-primary" style={{ alignSelf: 'flex-start', marginBottom: '0.75rem' }}>
                {svc.category}
              </span>

              <h3 style={{ fontSize: '1.2rem', marginBottom: '0.4rem' }}>{svc.name}</h3>
              <p style={{ color: 'var(--text-70)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                ⏱️ {svc.duration || '45-60 mins'}
              </p>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 'auto',
                  paddingTop: '1rem',
                  borderTop: '1px solid rgba(255,255,255,0.06)'
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-50)', display: 'block' }}>Starts at</span>
                  <strong style={{ color: 'var(--primary)', fontSize: '1.15rem' }}>
                    ₹{svc.basePrice?.toLocaleString('en-IN') || '499'}
                  </strong>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onSelectService && onSelectService(svc)}
                >
                  Book Now
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ResilientCatalog(props) {
  return (
    <ErrorBoundary>
      <ServiceCatalogView {...props} />
    </ErrorBoundary>
  );
}
