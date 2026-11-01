/**
 * src/modules/playback/vast.ts
 *
 * Builds VAST, the ad industry's standard XML for telling a video player what
 * to play and where to report back.
 */
export interface VastAd {
  id: string;
  title: string;
  advertiser: string;
  durationSeconds: number;
  videoUrl: string;
  width: number;
  height: number;
  clickThroughUrl: string;
  impressionUrl: string;
  trackingUrls: Record<
    'start' | 'firstQuartile' | 'midpoint' | 'thirdQuartile' | 'complete',
    string
  >;
}

const VERSION = '4.2';

const xml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const duration = (seconds: number): string => {
  const whole = Math.round(seconds);
  const part = (value: number): string => String(value).padStart(2, '0');
  return `${part(Math.floor(whole / 3600))}:${part(Math.floor(whole / 60) % 60)}:${part(whole % 60)}`;
};

/** An empty response tells the player there's no ad for this break. */
export const emptyVast = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<VAST version="${VERSION}"/>\n`;

export const buildVast = (ad: VastAd): string => {
  const tracking = Object.entries(ad.trackingUrls)
    .map(([event, url]) => `            <Tracking event="${event}"><![CDATA[${url}]]></Tracking>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="${VERSION}">
  <Ad id="${xml(ad.id)}">
    <InLine>
      <AdSystem>Campaign Analytics</AdSystem>
      <AdTitle>${xml(ad.title)}</AdTitle>
      <Advertiser>${xml(ad.advertiser)}</Advertiser>
      <Impression id="impression"><![CDATA[${ad.impressionUrl}]]></Impression>
      <Creatives>
        <Creative id="${xml(ad.id)}">
          <Linear>
            <Duration>${duration(ad.durationSeconds)}</Duration>
            <TrackingEvents>
${tracking}
            </TrackingEvents>
            <VideoClicks>
              <ClickThrough id="click"><![CDATA[${ad.clickThroughUrl}]]></ClickThrough>
            </VideoClicks>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="${ad.width}" height="${ad.height}"><![CDATA[${ad.videoUrl}]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>
`;
};
