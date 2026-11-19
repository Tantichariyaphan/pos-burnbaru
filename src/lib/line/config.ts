/** ค่าตั้งของ LINE จากตัวแปรสภาพแวดล้อมบนเซิร์ฟเวอร์เท่านั้น (ห้ามขึ้นต้น NEXT_PUBLIC_ ยกเว้น LIFF ID) */
export interface LineConfig {
  channelSecret: string;
  channelAccessToken: string;
  loginChannelId: string;
}

export function lineConfig(): LineConfig | null {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const loginChannelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelSecret || !channelAccessToken || !loginChannelId) return null;
  return { channelSecret, channelAccessToken, loginChannelId };
}
