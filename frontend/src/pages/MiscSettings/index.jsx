import React from "react";
import { ConfigProvider, Tabs } from "antd";
import { KeyOutlined, MonitorOutlined, SettingOutlined } from "@ant-design/icons";
import GeneralSettings from "./GeneralSettings";
import PasswordSettings from "./PasswordSettings";
import SignalMonitorTab from "./SignalMonitorTab";
import ConnectionInfoTab from "./ConnectionInfoTab";

export default function MiscSettings() {
  const tabItems = [
    {
      key: 'password',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyOutlined />
          패스워드 설정
        </span>
      ),
      children: <PasswordSettings />
    },
    {
      key: 'general',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SettingOutlined />
          기타 설정
        </span>
      ),
      children: <GeneralSettings />
    },
    {
      key: 'connection',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MonitorOutlined />
          연결 정보
        </span>
      ),
      children: <ConnectionInfoTab />
    },
    {
      key: 'signals',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MonitorOutlined />
          신호 상태 모니터
        </span>
      ),
      children: <SignalMonitorTab />
    }
  ];

  return (
    <ConfigProvider
      theme={{
        token: {
          // 브랜드 컬러 - 진한 파란색 적용
          colorPrimary: '#1c4ed8',
        },
        components: {
          Card: { 
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", 
            borderRadius: 8 
          },
          Tabs: {
            // 브랜드 컬러로 통일
            colorPrimary: '#1c4ed8',
            itemSelectedColor: '#1c4ed8',
            itemHoverColor: '#3b82f6', 
            itemActiveColor: '#1c4ed8',
            inkBarColor: '#1c4ed8',
            
            // 깔끔한 스타일링
            titleFontSize: 16,
            titleFontSizeLG: 16,
            horizontalItemPadding: '16px 0',
          }
        },
      }}
    >
      <div
        style={{
          padding: "32px",
          height: "100%",
          boxSizing: "border-box",
          background: "#fafafa",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            height: "100%",
          }}
        >
          <Tabs
            defaultActiveKey="general"
            items={tabItems}
            type="line"
            size="large"
            style={{
              height: "100%",
              background: "transparent",
            }}
            tabBarStyle={{
              marginBottom: "24px",
              background: "transparent",
              borderBottom: "1px solid #f0f0f0",
              paddingLeft: "0",
              paddingRight: "0",
            }}
            tabPaneStyle={{
              padding: "0",
              height: "calc(100% - 70px)",
              overflow: "auto",
            }}
          />
        </div>
      </div>
    </ConfigProvider>
  );
}
