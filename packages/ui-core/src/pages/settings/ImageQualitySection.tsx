import { useEffect, useState } from 'react';

import * as Icons from '../../components/Icons';
import { t } from '../../i18n/setup';
import { getSetting, putSetting } from '../../api/settings';

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

export default function ImageQualitySection() {
  const [maxRes, setMaxRes] = useState(2048);
  const [preserveDepth, setPreserveDepth] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getSetting<number>('max_image_resolution').catch(() => 2048),
      getSetting<boolean>('preserve_bit_depth').catch(() => false),
    ]).then(([res, depth]) => {
      if (res != null) setMaxRes(res);
      if (depth != null) setPreserveDepth(depth);
      setLoaded(true);
    });
  }, []);

  function handleMaxResChange(val: number) {
    setMaxRes(val);
    putSetting('max_image_resolution', val).catch(() => {});
  }

  function handlePreserveDepthToggle() {
    const next = !preserveDepth;
    setPreserveDepth(next);
    putSetting('preserve_bit_depth', next).catch(() => {});
  }

  if (!loaded) return null;

  const presetValues = [0, 1024, 2048, 4096, 8192];
  const presetLabels = [
    t('set.iq_unlimited'),
    '1024',
    '2048',
    '4096',
    '8192',
  ];

  return (
    <div style={{ ...glass, padding: '12px 14px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', marginBottom: 10,
      }}>
        <span style={{ marginRight: 8, display: 'flex' }}>
          <Icons.Image color="var(--accent)" size={14} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: 'var(--text)' }}>
          {t('set.iq_title')}
        </span>
      </div>

      {/* Max resolution */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
          {t('set.iq_max_res')}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {presetValues.map((val, i) => {
            const active = maxRes === val;
            return (
              <div
                key={val}
                onClick={() => handleMaxResChange(val)}
                className="btn-press"
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  background: active ? 'var(--pill-active-bg)' : 'var(--pill-bg)',
                  border: `1px solid ${active ? 'var(--pill-active-border)' : 'var(--pill-border)'}`,
                  color: active ? 'var(--accent)' : 'var(--text3)',
                  transition: 'all 0.2s ease',
                }}
              >
                {presetLabels[i]}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4 }}>
          {t('set.iq_max_res_desc')}
        </div>
      </div>

      {/* Preserve bit depth */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>
              {t('set.iq_bit_depth')}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
              {t('set.iq_bit_depth_desc')}
            </div>
          </div>
          <div
            onClick={handlePreserveDepthToggle}
            className="btn-press"
            style={{ cursor: 'pointer', display: 'flex', marginLeft: 8, flexShrink: 0 }}
          >
            {preserveDepth
              ? <Icons.ToggleRight color="var(--green)" size={22} />
              : <Icons.ToggleLeft color="var(--text3)" size={22} />}
          </div>
        </div>
      </div>
    </div>
  );
}
