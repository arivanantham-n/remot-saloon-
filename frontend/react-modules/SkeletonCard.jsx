import React from 'react';
import styles from './Skeleton.module.css';

/**
 * SkeletonCard — Dimensionally Accurate Loading Placeholder
 * 
 * Crucial CLS Prevention:
 * Has the exact padding, margin, border-radius, and aspect-ratio
 * of the loaded Service Card to guarantee 0.00 Cumulative Layout Shift.
 */
export function SkeletonCard({ count = 1 }) {
  const items = Array.from({ length: count }, (_, idx) => idx);

  return (
    <>
      {items.map((key) => (
        <div
          key={`skeleton-${key}`}
          className={styles.skeletonCard}
          aria-hidden="true"
          role="status"
          aria-label="Loading content..."
        >
          {/* Thumbnail placeholder */}
          <div className={`${styles.imagePlaceholder} ${styles.shimmerEffect}`} />

          {/* Category pill */}
          <div className={`${styles.categoryTag} ${styles.shimmerEffect}`} />

          {/* Service Title */}
          <div className={`${styles.titleLine} ${styles.shimmerEffect}`} />

          {/* Service Duration / Subtitle */}
          <div className={`${styles.descLineShort} ${styles.shimmerEffect}`} />

          {/* Price & Action Button Footer */}
          <div className={styles.footerRow}>
            <div className={`${styles.priceBlock} ${styles.shimmerEffect}`} />
            <div className={`${styles.buttonBlock} ${styles.shimmerEffect}`} />
          </div>
        </div>
      ))}
    </>
  );
}

export default SkeletonCard;
