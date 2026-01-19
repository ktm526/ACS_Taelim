// src/components/SideNav.jsx
import React from "react";
import { Menu, Button, message } from "antd";
import {
  HomeOutlined,
  ToolOutlined,
  SettingOutlined,
  MobileOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import { useAtom } from "jotai";
import { sessionIdAtom, isLoggedInAtom, userInfoAtom } from "@/state/atoms";
import { useApiClient } from "@/hooks/useApiClient";

const items = [
  { key: "/", icon: <HomeOutlined />, label: "메인" },
  { key: "/map", icon: <ToolOutlined />, label: "맵 설정" },
  { key: "/devices", icon: <SettingOutlined />, label: "장치 설정" },
  { key: "/settings", icon: <SettingOutlined />, label: "기타 설정" },
  // { key: "/mobile", icon: <MobileOutlined />, label: "📱 모바일" },
];

export default function SideNav({ collapsed }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [sessionId, setSessionId] = useAtom(sessionIdAtom);
  const [, setIsLoggedIn] = useAtom(isLoggedInAtom);
  const [, setUserInfo] = useAtom(userInfoAtom);
  const apiClient = useApiClient();

  const performLogout = async () => {
    try {
      // 서버에 로그아웃 요청
      await apiClient.post('/api/config/logout', {
        sessionId: sessionId
      });

      // 로컬 상태 및 스토리지 정리
      localStorage.removeItem('sessionId');
      setSessionId(null);
      setIsLoggedIn(false);
      setUserInfo({ userType: null, loginTime: null });

      message.success('로그아웃되었습니다.');
    } catch (error) {
      console.error('로그아웃 오류:', error);
      // 에러가 발생해도 로컬 정리는 수행
      localStorage.removeItem('sessionId');
      setSessionId(null);
      setIsLoggedIn(false);
      setUserInfo({ userType: null, loginTime: null });
      
      message.warning('로그아웃 중 오류가 발생했지만 로그아웃되었습니다.');
    }
  };

  const handleLogout = (e) => {
    // 이벤트 전파 방지 (사이드바 토글 방지)
    e.stopPropagation();
    
    // 브라우저 기본 confirm 사용
    if (confirm('정말로 로그아웃하시겠습니까?')) {
      performLogout();
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%'
    }}>
      {/* 메뉴 영역 - 세로 중앙 정렬 */}
      <div style={{ 
        flex: 1, 
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 0  // flex item이 최소 크기를 갖지 않도록
      }}>
        <Menu
          mode="inline"
          theme="light"
          items={items}
          selectedKeys={[pathname]}
          onClick={({ key }) => nav(key)}
          inlineCollapsed={collapsed}
          style={{ 
            borderInlineEnd: 0,
            backgroundColor: 'transparent'
          }}
        />
      </div>
      
      {/* 로그아웃 버튼 - 최하단 고정 */}
      <div 
        style={{ 
          padding: collapsed ? '12px 8px 16px 8px' : '16px',
          borderTop: '1px solid #f0f0f0',
          marginTop: 'auto'  // 최하단으로 밀어내기
        }}
        onClick={(e) => e.stopPropagation()} // 이 영역 클릭 시에도 토글 방지
      >
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={handleLogout}
          block={!collapsed}
          style={collapsed ? {
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            color: '#666',
            borderRadius: '6px'
          } : {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            color: '#666',
            height: '40px',
            borderRadius: '6px'
          }}
        >
          {!collapsed && '로그아웃'}
        </Button>
      </div>
    </div>
  );
}
