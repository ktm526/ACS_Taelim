// src/App.jsx
import React, { useState, useEffect } from "react";
import { Layout, Spin, Modal } from "antd";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAtom } from "jotai";
import { sessionIdAtom, isLoggedInAtom, userInfoAtom } from "@/state/atoms";
import { useApiClient } from "@/hooks/useApiClient";
import SideNav from "@/components/SideNav";
// ─── Home.jsx 파일이 src/pages/Home 폴더 안에 있다면 이렇게 import ───
import Home from "@/pages/Home";
import MapSettings from "@/pages/MapSettings";
import MiscSettings from "@/pages/MiscSettings";
import DeviceSettings from "@/pages/DeviceSettings";
import TaskLogs from "@/pages/TaskLogs";
import MobileStatus from "@/pages/Mobile/MobileStatus";
import Login from "@/pages/Login";
import logo from "@/assets/logo.png";

const { Sider, Content } = Layout;

export default function App() {
  const location = useLocation();
  const isMobile = location.pathname.startsWith('/mobile');
  
  // 인증 상태 관리
  const [sessionId, setSessionId] = useAtom(sessionIdAtom);
  const [isLoggedIn, setIsLoggedIn] = useAtom(isLoggedInAtom);
  const [, setUserInfo] = useAtom(userInfoAtom);
  const [isLoading, setIsLoading] = useState(true);
  const apiClient = useApiClient();

  // ① localStorage 에서 불러오기, 기본값 false
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("siderCollapsed")) ?? false;
    } catch {
      return false;
    }
  });

  // ② collapsed 변경 시 localStorage 에 저장
  useEffect(() => {
    localStorage.setItem("siderCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  // 세션 검증
  useEffect(() => {
    const verifySession = async () => {
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await apiClient.post('/api/config/verify-session', {
          sessionId: sessionId
        });

        if (response.success) {
          setIsLoggedIn(true);
          setUserInfo({
            userType: response.session.userType,
            loginTime: response.session.createdAt
          });
        } else {
          // 세션이 유효하지 않은 경우 정리 및 알림
          localStorage.removeItem('sessionId');
          setSessionId(null);
          setIsLoggedIn(false);
          setUserInfo({ userType: null, loginTime: null });
          
          // 세션 만료 알림
          if (response.message && response.message.includes('만료')) {
            Modal.warning({
              title: '세션 만료',
              content: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
              okText: '확인',
              centered: true,
            });
          } else if (response.message && response.message.includes('유효하지')) {
            Modal.warning({
              title: '세션 오류',
              content: '로그인 정보가 유효하지 않습니다. 다시 로그인해주세요.',
              okText: '확인',
              centered: true,
            });
          }
        }
      } catch (error) {
        console.error('세션 검증 오류:', error);
        // 에러 발생 시에도 정리
        localStorage.removeItem('sessionId');
        setSessionId(null);
        setIsLoggedIn(false);
        setUserInfo({ userType: null, loginTime: null });
        
        // 네트워크 오류 등의 경우 알림
        Modal.error({
          title: '연결 오류',
          content: '서버와의 연결에 문제가 발생했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해주세요.',
          okText: '확인',
          centered: true,
        });
      } finally {
        setIsLoading(false);
      }
    };

    verifySession();
  }, [sessionId, setIsLoggedIn, setUserInfo, apiClient, setSessionId]);

  // 바깥(메뉴 아이템 아닌) 클릭 시 토글
  const handleSiderClick = (e) => {
    if (!e.target.closest(".ant-menu-item")) {
      setCollapsed((prev) => !prev);
    }
  };

  // 로딩 중인 경우
  if (isLoading) {
    return (
      <Layout style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Spin size="large" />
      </Layout>
    );
  }

  // 로그인되지 않은 경우 로그인 페이지 표시 (모바일 제외)
  if (!isLoggedIn && !isMobile) {
    return <Login />;
  }

  // 모바일 전용 레이아웃
  if (isMobile) {
    return (
      <Layout style={{ minHeight: "100vh" }}>
        <Content style={{ padding: 0 }}>
          <Routes>
            <Route path="/mobile" element={<MobileStatus />} />
          </Routes>
        </Content>
      </Layout>
    );
  }

  // 데스크톱 레이아웃 (로그인된 경우)
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        className="ello-sider"
        width={200}
        collapsed={collapsed}
        collapsedWidth={64}
        trigger={null}
        theme="light"
        style={{ background: "#fff", display: "flex", flexDirection: "column" }}
        onClick={handleSiderClick}
      >
        {/* ─── 로고 영역 (접히면 숨김) ─── */}
        {!collapsed && (
          <div className="ello-logo-box">
            <img src={logo} alt="ELLO" style={{ height: 32 }} />
          </div>
        )}

        {/* ─── 메뉴 (항상 세로 가운데) ─── */}
        <div className="menu-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <SideNav collapsed={collapsed} />
        </div>
      </Sider>

      <Layout>
        <Content style={{ padding: 0 }}>
          <Routes>
            <Route path="/" element={<Home />}  />
            <Route path="/map" element={<MapSettings />} />
            <Route path="/task-logs" element={<TaskLogs />} />
            {/* 로그 기능은 서버 개편으로 제거됨 */}
            <Route path="/logs" element={<Navigate to="/" replace />} />
            <Route path="/settings" element={<MiscSettings />} />
            <Route path="/devices" element={<DeviceSettings />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
